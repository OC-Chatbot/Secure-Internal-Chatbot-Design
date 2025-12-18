from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Literal, Optional
from uuid import uuid4
import hashlib
import secrets
import os

from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.llm_model import generate_text

# Enable mock auth bypass in development/testing
MOCK_AUTH_ENABLED = os.getenv("MOCK_AUTH_ENABLED", "true").lower() == "true"


app = FastAPI(title="Opportunity Center Chat Backend", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    id: str
    content: str
    role: Literal["user", "assistant"]
    timestamp: str
    conversationId: str


class SendMessageRequest(BaseModel):
    message: str
    conversationId: Optional[str] = None


class SendMessageResponse(BaseModel):
    message: ChatMessage
    conversationId: str


class ConversationSummary(BaseModel):
    id: str
    title: str
    createdAt: str
    updatedAt: str
    messageCount: int


class ApiKeyRequest(BaseModel):
    name: str
    title: str
    createdAt: str
    updatedAt: str
    messageCount: int


class ChatHistoryResponse(BaseModel):
    messages: List[ChatMessage]
    conversationId: str


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    createdAt: str


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


# --- Data ---

conversation_messages: dict[str, dict[str, list[ChatMessage]]] = {}
conversation_metadata: dict[str, dict[str, dict[str, datetime | str]]] = {}

# Session management
sessions: dict[str, dict] = {}  # token -> {user_id, expires_at, created_at}
SESSION_TIMEOUT_MINUTES = 60  # Configurable session timeout

# Password storage (in production, use proper password hashing library like bcrypt)
user_passwords: dict[str, str] = {}  # user_id -> hashed_password

# Password reset tokens
reset_tokens: dict[str, dict] = {}  # token -> {user_id, email, expires_at, created_at}
RESET_TOKEN_TIMEOUT_MINUTES = 60  # Reset link valid for 1 hour


def hash_password(password: str) -> str:
    """Hash password using SHA-256 with salt"""
    salt = secrets.token_hex(16)
    pwd_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}${pwd_hash}"


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    try:
        salt, pwd_hash = hashed.split('$')
        return hashlib.sha256((password + salt).encode()).hexdigest() == pwd_hash
    except:
        return False


def create_session(user_id: str) -> str:
    """Create a new session token"""
    token = secrets.token_urlsafe(32)
    sessions[token] = {
        "user_id": user_id,
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(minutes=SESSION_TIMEOUT_MINUTES),
        "last_activity": datetime.utcnow()
    }
    return token


def validate_session(token: str) -> Optional[str]:
    """Validate session and return user_id if valid"""
    if not token or token not in sessions:
        return None
    
    session = sessions[token]
    now = datetime.utcnow()
    
    # Check if session expired
    if now > session["expires_at"]:
        del sessions[token]
        return None
    
    # Update last activity and extend expiration
    session["last_activity"] = now
    session["expires_at"] = now + timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    
    return session["user_id"]


def require_auth(authorization: Optional[str] = Header(None)) -> str:
    """Dependency to require authentication"""
    if not authorization or not authorization.startswith("Bearer "):
        # Allow mock bypass when enabled (dev/test only)
        if MOCK_AUTH_ENABLED:
            return "test-user"
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")

    # Mock token shortcut
    if MOCK_AUTH_ENABLED and token == "mock-test-token":
        return "test-user"

    user_id = validate_session(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return user_id


def require_role(required_role: str):
    """Dependency factory to require specific role"""
    def role_checker(user_id: str = Depends(require_auth)) -> str:
        user = next((u for u in users_db if u["id"] == user_id), None)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user_role = user["role"]
        
        # Role hierarchy: super-admin > admin > user
        role_hierarchy = {"super-admin": 3, "admin": 2, "user": 1}
        required_level = role_hierarchy.get(required_role, 0)
        user_level = role_hierarchy.get(user_role, 0)
        
        if user_level < required_level:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return user_id
    return role_checker


def _get_user_id(request: Request) -> str:
    user_id = request.headers.get("x-user-id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")
    return user_id


def _get_user_message_store(user_id: str) -> dict[str, list[ChatMessage]]:
    return conversation_messages.setdefault(user_id, {})


def _get_user_metadata_store(user_id: str) -> dict[str, dict[str, datetime | str]]:
    return conversation_metadata.setdefault(user_id, {})


def _derive_title(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return "New Conversation"
    return cleaned[:60] + ("..." if len(cleaned) > 60 else "")


def _create_conversation(user_id: str, first_user_message: str) -> str:
    user_meta = _get_user_metadata_store(user_id)
    user_messages = _get_user_message_store(user_id)
    conv_id = str(uuid4())
    now = datetime.utcnow()
    user_meta[conv_id] = {
        "title": _derive_title(first_user_message),
        "created_at": now,
        "updated_at": now,
    }
    user_messages[conv_id] = []
    return conv_id


def _ensure_conversation(
    user_id: str, conversation_id: Optional[str], user_message: str
) -> str:
    user_meta = _get_user_metadata_store(user_id)
    if conversation_id and conversation_id in user_meta:
        return conversation_id
    return _create_conversation(user_id, user_message)


def _store_message(
    user_id: str, conversation_id: str, role: Literal["user", "assistant"], content: str
) -> ChatMessage:
    user_messages = _get_user_message_store(user_id)
    user_meta = _get_user_metadata_store(user_id)

    if conversation_id not in user_messages:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    message = ChatMessage(
        id=str(uuid4()),
        content=content,
        role=role,
        timestamp=datetime.utcnow().isoformat(),
        conversationId=conversation_id,
    )
    user_messages[conversation_id].append(message)

    meta = user_meta[conversation_id]
    meta["updated_at"] = datetime.utcnow()
    if role == "user" and (not meta.get("title") or meta["title"] == "New Conversation"):
        meta["title"] = _derive_title(content)

    return message


def _build_prompt(user_id: str, conversation_id: str) -> str:
    history = _get_user_message_store(user_id).get(conversation_id, [])
    recent_history = history[-10:]

    latest_user = next(
        (msg for msg in reversed(recent_history) if msg.role == "user"), None
    )

    history_lines = []
    for msg in recent_history:
        role = "User" if msg.role == "user" else "Assistant"
        history_lines.append(f"{role}: {msg.content}")
    history_block = "\n".join(history_lines)

    if not latest_user:
        latest_content = ""
    else:
        latest_content = latest_user.content

    system = (
        "You are a helpful assistant for the Opportunity Center. "
        "Provide a single concise answer to the most recent user question. "
        "Do not invent or ask questions. Reply with only the answer text, no prefixes or labels. "
        "Keep replies under 80 words."
    )

    return (
        f"{system}\n\n"
        f"Recent conversation:\n{history_block}\n\n"
        f"Answer the latest user question once. Do not add new questions.\n"
        f"Latest question: {latest_content}\n"
        f"Answer:"
    )


def _conversation_summary(user_id: str, conversation_id: str) -> ConversationSummary:
    user_meta = _get_user_metadata_store(user_id)
    user_messages = _get_user_message_store(user_id)

    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    meta = user_meta[conversation_id]
    messages = user_messages.get(conversation_id, [])

    title = meta.get("title", "New Conversation")
    if (not title or title == "New Conversation") and messages:
        for msg in messages:
            if msg.role == "user":
                title = _derive_title(msg.content)
                break

    return ConversationSummary(
        id=conversation_id,
        title=title or "Conversation",
        createdAt=meta["created_at"].isoformat(),
        updatedAt=meta["updated_at"].isoformat(),
        messageCount=len(messages),
    )

# --- Endpoints ---

@app.get("/")
async def root():
    return {"message": "Opportunity Center Chat API", "status": "ok"}


# --- Auth Endpoints ---

@app.post("/api/auth/register", response_model=AuthResponse)
def register(req: RegisterRequest):
    # Check if user already exists
    existing_user = next((u for u in users_db if u["email"] == req.email), None)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Hash password
    hashed_pwd = hash_password(req.password)
    
    # Create new user
    new_user = {
        "id": f"user-{len(users_db) + 1}",
        "email": req.email,
        "name": req.name,
        "role": "user",
        "createdAt": datetime.utcnow().isoformat() + "Z"
    }
    users_db.append(new_user)
    user_passwords[new_user["id"]] = hashed_pwd
    
    # Create session
    token = create_session(new_user["id"])
    
    return AuthResponse(
        token=token,
        user=UserResponse(**new_user)
    )


@app.post("/api/auth/login", response_model=AuthResponse)
def login(req: LoginRequest):
    # Find user by email
    user = next((u for u in users_db if u["email"] == req.email), None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Verify password
    stored_password = user_passwords.get(user["id"])
    if not stored_password or not verify_password(req.password, stored_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create session
    token = create_session(user["id"])
    
    return AuthResponse(
        token=token,
        user=UserResponse(**user)
    )


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        if token in sessions:
            del sessions[token]
    return {"message": "Logged out successfully"}


@app.get("/api/auth/me", response_model=UserResponse)
def get_current_user(user_id: str = Depends(require_auth)):
    user = next((u for u in users_db if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**user)


@app.post("/api/auth/refresh", response_model=AuthResponse)
def refresh_token(user_id: str = Depends(require_auth)):
    user = next((u for u in users_db if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Create new session
    token = create_session(user["id"])
    return AuthResponse(
        token=token,
        user=UserResponse(**user)
    )


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetSubmit(BaseModel):
    token: str
    new_password: str


class UsernameRecoveryRequest(BaseModel):
    email: str


@app.post("/api/auth/reset-password-request")
def request_password_reset(request: PasswordResetRequest):
    """Request a password reset link"""
    user = next((u for u in users_db if u["email"] == request.email), None)
    
    # Always return success to prevent email enumeration
    # In production, send actual email here
    if user:
        # Generate reset token
        token = secrets.token_urlsafe(32)
        reset_tokens[token] = {
            "user_id": user["id"],
            "email": user["email"],
            "created_at": datetime.utcnow(),
            "expires_at": datetime.utcnow() + timedelta(minutes=RESET_TOKEN_TIMEOUT_MINUTES)
        }
        
        # In production, send email with link: http://localhost:3000/recovery/reset-password/{token}
        print(f"Password reset link for {request.email}: http://localhost:3000/recovery/reset-password/{token}")
    
    return {
        "message": "If an account exists with this email, a password reset link has been sent",
        "success": True
    }


@app.get("/api/auth/validate-reset-token")
def validate_reset_token(token: str):
    """Validate a password reset token"""
    if token not in reset_tokens:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    token_data = reset_tokens[token]
    now = datetime.utcnow()
    
    if now > token_data["expires_at"]:
        del reset_tokens[token]
        raise HTTPException(status_code=400, detail="Reset token has expired")
    
    return {"valid": True}


@app.post("/api/auth/reset-password")
def reset_password(request: PasswordResetSubmit):
    """Reset password using valid token"""
    if request.token not in reset_tokens:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    token_data = reset_tokens[request.token]
    now = datetime.utcnow()
    
    if now > token_data["expires_at"]:
        del reset_tokens[request.token]
        raise HTTPException(status_code=400, detail="Reset token has expired")
    
    # Update password
    user_id = token_data["user_id"]
    user_passwords[user_id] = hash_password(request.new_password)
    
    # Invalidate token
    del reset_tokens[request.token]
    
    # Invalidate all sessions for this user
    tokens_to_delete = [t for t, s in sessions.items() if s["user_id"] == user_id]
    for t in tokens_to_delete:
        del sessions[t]
    
    return {
        "message": "Password has been reset successfully",
        "success": True
    }


@app.post("/api/auth/recover-username")
def recover_username(request: UsernameRecoveryRequest):
    """Recover username by email"""
    user = next((u for u in users_db if u["email"] == request.email), None)
    
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email address")
    
    # In production, send email with username
    print(f"Username recovery for {request.email}: {user['email']}")
    
    return {
        "message": "Username has been sent to your email",
        "username": user["email"],  # In this app, email is the username
        "success": True
    }


@app.get("/api/chat/conversations", response_model=List[ConversationSummary])
def list_conversations(request: Request):
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)

    summaries = [_conversation_summary(user_id, conv_id) for conv_id in user_meta]
    summaries.sort(key=lambda s: s.updatedAt, reverse=True)
    return summaries


@app.get("/api/chat/conversations/{conversation_id}", response_model=ChatHistoryResponse)
def get_conversation(conversation_id: str, request: Request):
    user_id = _get_user_id(request)
    user_messages = _get_user_message_store(user_id)

    if conversation_id not in user_messages:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return ChatHistoryResponse(
        messages=user_messages[conversation_id],
        conversationId=conversation_id,
    )


# --- API Key Management ---

api_keys_db = {}  # key_id -> {id, name, key_hash, createdAt, lastUsed}
api_key_usage_logs = []  # List of {keyId, action, timestamp}


def hash_api_key(key: str) -> str:
    """Hash API key using SHA-256 with salt"""
    salt = secrets.token_hex(16)
    key_hash = hashlib.sha256((key + salt).encode()).hexdigest()
    return f"{salt}${key_hash}"


def verify_api_key(key: str, hashed: str) -> bool:
    """Verify API key against hash"""
    try:
        salt, key_hash = hashed.split('$')
        return hashlib.sha256((key + salt).encode()).hexdigest() == key_hash
    except:
        return False


def generate_api_key() -> str:
    """Generate a cryptographically secure API key"""
    return "sk_" + secrets.token_urlsafe(32)


def mask_api_key(key: str) -> str:
    """Return masked key (show last 4 chars only)"""
    if len(key) <= 4:
        return "*" * len(key)
    return "*" * (len(key) - 4) + key[-4:]


# --- Admin Endpoints ---

# Available LLM models (would come from DB/service in production)
available_models = [
    "GPT-2 (Local)",
    "GPT-3.5 Turbo",
    "GPT-4",
    "GPT-4o Mini",
]

# In-memory system settings
system_settings = {
    "model": available_models[0],
    "temperature": 0.2,
    "maxTokens": 80,
    "systemPrompt": "You are a helpful assistant for the Opportunity Center. Provide concise answers to questions.",
    "rateLimit": 60
}

# Mock users database - Universal test user with admin role
users_db = [
    {
        "id": "test-user",
        "name": "Test User",
        "email": "test@example.com",
        "role": "admin",
        "createdAt": "2024-01-01T00:00:00Z"
    }
]

# Initialize default passwords (password: "admin123" for all)
for user in users_db:
    user_passwords[user["id"]] = hash_password("admin123")

@app.get("/api/admin/stats")
def get_admin_stats(user_id: str = Depends(require_role("admin"))):
    # Calculate actual stats from stored data
    total_users = len(users_db)
    total_conversations = sum(len(convs) for convs in conversation_messages.values())
    total_messages = sum(
        len(messages) 
        for user_convs in conversation_messages.values() 
        for messages in user_convs.values()
    )
    # Count users with at least one conversation
    active_users = sum(1 for user_convs in conversation_messages.values() if user_convs)
    
    return {
        "totalUsers": total_users,
        "totalConversations": total_conversations,
        "totalMessages": total_messages,
        "activeUsers": active_users,
    }

@app.get("/api/admin/users")
def get_admin_users(user_id: str = Depends(require_role("admin"))):
    return users_db

@app.post("/api/admin/users")
def create_admin_user(data: dict, user_id: str = Depends(require_role("admin"))):
    # Check if user already exists
    existing_user = next((u for u in users_db if u["email"] == data.get("email")), None)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists")
    
    # Only super-admin can create admin or super-admin users
    requesting_user = next((u for u in users_db if u["id"] == user_id), None)
    new_role = data.get("role", "user")
    
    if new_role in ["admin", "super-admin"] and requesting_user["role"] != "super-admin":
        raise HTTPException(status_code=403, detail="Only super-admin can create admin users")
    
    # Hash password
    password = data.get("password", "password123")
    hashed_pwd = hash_password(password)
    
    # Create new user
    new_user = {
        "id": f"user-{len(users_db) + 1}",
        "name": data.get("name"),
        "email": data.get("email"),
        "role": new_role,
        "createdAt": datetime.utcnow().isoformat() + "Z"
    }
    users_db.append(new_user)
    user_passwords[new_user["id"]] = hashed_pwd
    return new_user

@app.get("/api/admin/settings")
def get_admin_settings(user_id: str = Depends(require_role("admin"))):
    return {
        **system_settings,
        "sessionTimeoutMinutes": SESSION_TIMEOUT_MINUTES
    }


@app.get("/api/admin/models")
def get_available_models(user_id: str = Depends(require_role("admin"))):
    return {"models": available_models}

@app.put("/api/admin/settings")
def update_admin_settings(settings: dict, user_id: str = Depends(require_role("super-admin"))):
    # Only super-admin can update settings
    global SESSION_TIMEOUT_MINUTES
    
    # Update timeout if provided
    if "sessionTimeoutMinutes" in settings:
        SESSION_TIMEOUT_MINUTES = settings["sessionTimeoutMinutes"]
    
    # Update only provided fields
    for key, value in settings.items():
        if key in system_settings:
            system_settings[key] = value
    
    return {
        **system_settings,
        "sessionTimeoutMinutes": SESSION_TIMEOUT_MINUTES
    }

@app.get("/api/admin/users/{user_id}")
def get_admin_user(user_id: str, admin_user_id: str = Depends(require_role("admin"))):
    user = next((u for u in users_db if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/api/admin/users/{user_id}")
def update_admin_user(user_id: str, data: dict, admin_user_id: str = Depends(require_role("admin"))):
    user = next((u for u in users_db if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check role change permissions
    if "role" in data:
        requesting_user = next((u for u in users_db if u["id"] == admin_user_id), None)
        new_role = data["role"]
        
        # Only super-admin can change roles to admin or super-admin
        if new_role in ["admin", "super-admin"] and requesting_user["role"] != "super-admin":
            raise HTTPException(status_code=403, detail="Only super-admin can assign admin roles")
        
        # Cannot demote the last super-admin
        if user["role"] == "super-admin" and new_role != "super-admin":
            super_admin_count = sum(1 for u in users_db if u["role"] == "super-admin")
            if super_admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last super-admin")
    
    # Update user fields
    for key, value in data.items():
        if key in user and key != "id":
            user[key] = value
    return user

@app.delete("/api/admin/users/{user_id}")
def delete_admin_user(user_id: str, admin_user_id: str = Depends(require_role("admin"))):
    global users_db
    user = next((u for u in users_db if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cannot delete yourself
    if user_id == admin_user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    # Cannot delete the last super-admin
    if user["role"] == "super-admin":
        super_admin_count = sum(1 for u in users_db if u["role"] == "super-admin")
        if super_admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last super-admin")
    
    # Only super-admin can delete admin users
    requesting_user = next((u for u in users_db if u["id"] == admin_user_id), None)
    if user["role"] in ["admin", "super-admin"] and requesting_user["role"] != "super-admin":
        raise HTTPException(status_code=403, detail="Only super-admin can delete admin users")
    
    users_db = [u for u in users_db if u["id"] != user_id]
    if user_id in user_passwords:
        del user_passwords[user_id]
    return {"message": "User deleted successfully"}


@app.get("/api/admin/api-keys")
def get_api_keys(user_id: str = Depends(require_role("admin"))):
    """Get all API keys (masked)"""
    keys = [
        {
            "id": key_data["id"],
            "name": key_data["name"],
            "key": mask_api_key(key_data["key_hash"]),  # Masked
            "createdAt": key_data["createdAt"],
            "lastUsed": key_data.get("lastUsed"),
        }
        for key_data in api_keys_db.values()
    ]
    return keys


@app.post("/api/admin/api-keys")
def create_api_key(
    request: ApiKeyRequest, user_id: str = Depends(require_role("super-admin"))
):
    """Create a new API key (only super-admin)"""
    # Generate a new key
    new_key = generate_api_key()
    key_id = str(uuid4())
    
    # Hash and store
    key_hash = hash_api_key(new_key)
    api_keys_db[key_id] = {
        "id": key_id,
        "name": request.name or f"Key {len(api_keys_db) + 1}",
        "key_hash": key_hash,
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "lastUsed": None,
    }
    
    # Log the creation
    api_key_usage_logs.append({
        "keyId": key_id,
        "action": "created",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })
    
    # Return full key only once (will not be retrievable later)
    return {
        "id": key_id,
        "name": api_keys_db[key_id]["name"],
        "key": mask_api_key(key_hash),  # Masked for consistency
        "fullKey": new_key,  # Only shown here
        "createdAt": api_keys_db[key_id]["createdAt"],
        "lastUsed": None,
    }


@app.delete("/api/admin/api-keys/{key_id}")
def revoke_api_key(
    key_id: str, user_id: str = Depends(require_role("super-admin"))
):
    """Revoke (delete) an API key"""
    if key_id not in api_keys_db:
        raise HTTPException(status_code=404, detail="API key not found")
    
    del api_keys_db[key_id]
    
    # Log the revocation
    api_key_usage_logs.append({
        "keyId": key_id,
        "action": "revoked",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })
    
    return {"message": "API key revoked successfully"}



def chat_with_llm(req: SendMessageRequest, request: Request):
    user_id = _get_user_id(request)
    message_text = req.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    conversation_id = _ensure_conversation(user_id, req.conversationId, message_text)

    # Add the user message to history before calling the model
    _store_message(user_id, conversation_id, "user", message_text)

    prompt = _build_prompt(user_id, conversation_id)

    try:
        reply_text = generate_text(
            prompt=prompt,
            max_new_tokens=80,
            temperature=0.2,
            top_p=0.8,
            do_sample=False,
            wrap_prompt=False,
            strip_after="Answer:",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="LLM generation failed.")

    assistant_message = _store_message(user_id, conversation_id, "assistant", reply_text)

    return SendMessageResponse(
        message=assistant_message,
        conversationId=conversation_id,
    )


@app.delete("/api/chat/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, request: Request):
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)

    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    _get_user_message_store(user_id).pop(conversation_id, None)
    user_meta.pop(conversation_id, None)
    return {"message": "Conversation deleted."}


@app.delete("/api/chat/conversations/{conversation_id}/messages")
def clear_conversation_messages(conversation_id: str, request: Request):
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    user_messages = _get_user_message_store(user_id)

    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    user_messages[conversation_id] = []
    user_meta[conversation_id]["updated_at"] = datetime.utcnow()
    return {"message": "Conversation messages cleared."}



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
