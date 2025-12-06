from __future__ import annotations

# Standard libs
from datetime import datetime
from typing import List, Literal, Optional
from uuid import uuid4

# FastAPI / Pydantic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Local LLM interface (synchronous helper used by chat endpoint)
from backend.llm_model import generate_text

# LLM proxy router (optional). If backend/llm_proxy.py is not present, register an empty router.
try:
    # Allows /api/llm/* routes when llm_proxy module exists
    from backend.llm_proxy import router as llm_router
except ImportError:
    # Fallback so app startup does not fail when the module is absent
    from fastapi import APIRouter
    llm_router = APIRouter()

# --- App setup ---
# Create FastAPI app and set metadata
app = FastAPI(title="Opportunity Center Chat Backend", version="1.0.0")

# Health check endpoint (lightweight)
@app.get("/__health")
def health():
    return {"status": "ok"}

# Configure CORS for local Next.js frontend during development.
# If you deploy to production, update allow_origins to exact domain(s).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the LLM proxy router (Hugging Face or other provider)
# This mounts any routes defined in backend/llm_proxy.py under the main app.
app.include_router(llm_router)


# --- Pydantic models (API request/response shapes) ---

class ChatMessage(BaseModel):
    """Represents a single chat message in a conversation."""
    id: str
    content: str
    role: Literal["user", "assistant"]
    timestamp: str
    conversationId: str


class SendMessageRequest(BaseModel):
    """Payload sent by the frontend when posting a user message."""
    message: str
    conversationId: Optional[str] = None


class SendMessageResponse(BaseModel):
    """Response for a posted message that includes the assistant reply and conversation id."""
    message: ChatMessage
    conversationId: str


class ConversationSummary(BaseModel):
    """Summary metadata for a conversation (used in conversation list)."""
    id: str
    title: str
    createdAt: str
    updatedAt: str
    messageCount: int


class ChatHistoryResponse(BaseModel):
    """Response payload when retrieving the messages for a conversation."""
    messages: List[ChatMessage]
    conversationId: str


# --- In-memory data stores (simple for demo / dev) ---
# conversation_messages: user_id -> conversation_id -> list[ChatMessage]
conversation_messages: dict[str, dict[str, list[ChatMessage]]] = {}
# conversation_metadata: user_id -> conversation_id -> metadata (title, created_at, updated_at)
conversation_metadata: dict[str, dict[str, dict[str, datetime | str]]] = {}


# --- Helper functions ---
def _get_user_id(request: Request) -> str:
    """
    Determine the "user" for this request.
    In this demo we support an 'x-user-id' header to separate data per user.
    Default to 'admin' if not provided.
    """
    return request.headers.get("x-user-id") or "admin"


def _get_user_message_store(user_id: str) -> dict[str, list[ChatMessage]]:
    """Get or create the message store for a user."""
    return conversation_messages.setdefault(user_id, {})


def _get_user_metadata_store(user_id: str) -> dict[str, dict[str, datetime | str]]:
    """Get or create the metadata store for a user."""
    return conversation_metadata.setdefault(user_id, {})


def _derive_title(text: str) -> str:
    """Create a short conversation title from the first user message."""
    cleaned = text.strip()
    if not cleaned:
        return "New Conversation"
    return cleaned[:60] + ("..." if len(cleaned) > 60 else "")


def _create_conversation(user_id: str, first_user_message: str) -> str:
    """Create a new conversation and return its id."""
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


def _ensure_conversation(user_id: str, conversation_id: Optional[str], user_message: str) -> str:
    """
    Ensure a conversation exists:
    - If conversation_id provided and known, return it.
    - Else create a new conversation seeded with the user message.
    """
    user_meta = _get_user_metadata_store(user_id)
    if conversation_id and conversation_id in user_meta:
        return conversation_id
    return _create_conversation(user_id, user_message)


def _store_message(user_id: str, conversation_id: str, role: Literal["user", "assistant"], content: str) -> ChatMessage:
    """
    Append a message to the conversation message list and update metadata.
    Raises 404 if conversation not found.
    """
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

    # Update conversation metadata (updated_at and possibly title)
    meta = user_meta[conversation_id]
    meta["updated_at"] = datetime.utcnow()
    if role == "user" and (not meta.get("title") or meta["title"] == "New Conversation"):
        meta["title"] = _derive_title(content)

    return message


def strip_signature(text: str) -> str:
    """
    Remove common trailing sign-offs or 'Conclusion' blocks from model output.
    Keeps and returns only the first meaningful part of the output.
    """
    import re

    if not text:
        return text

    # Split on common closing phrases and keep the text before them.
    parts = re.split(
        r'\n\s*(?:Regards|Best regards|Sincerely|Conclusion|Thanks|Thank you)[\s,:-]?.*$',
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    return parts[0].strip()


def _build_prompt(user_id: str, conversation_id: str) -> str:
    """
    Build a deterministic prompt for the LLM based on recent conversation history.
    - Includes a system instruction to constrain output style and length.
    - Uses the last ~10 messages to provide context.
    """
    history = _get_user_message_store(user_id).get(conversation_id, [])
    recent_history = history[-10:]
    latest_user = next((msg for msg in reversed(recent_history) if msg.role == "user"), None)
    latest_content = latest_user.content if latest_user else ""

    system = (
        "You are a helpful assistant for the Opportunity Center. "
        "Provide a single concise answer to the most recent user question. "
        "Do not invent or ask questions. Reply with only the answer text, no prefixes or labels. "
        "Keep replies under 80 words."
    )

    # Turn message history into a simple chat log for the prompt
    history_lines = [f"{'User' if msg.role == 'user' else 'Assistant'}: {msg.content}" for msg in recent_history]
    history_block = "\n".join(history_lines)

    return (
        f"{system}\n\n"
        f"Recent conversation:\n{history_block}\n\n"
        f"Answer the latest user question once. Do not add new questions.\n"
        f"Latest question: {latest_content}\n"
        f"Answer:"
    )


def _conversation_summary(user_id: str, conversation_id: str) -> ConversationSummary:
    """Create a ConversationSummary from stored metadata and messages."""
    user_meta = _get_user_metadata_store(user_id)
    user_messages = _get_user_message_store(user_id)

    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    meta = user_meta[conversation_id]
    messages = user_messages.get(conversation_id, [])

    title = meta.get("title", "New Conversation")
    # If the title is not set, derive it from the first user message
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


# --- Endpoints (public API surface) ---

@app.get("/")
async def root():
    """Root endpoint describing the API."""
    return {"message": "Opportunity Center Chat API", "status": "ok"}


@app.get("/api/chat/conversations", response_model=List[ConversationSummary])
def list_conversations(request: Request):
    """List all conversations for the requesting user (summary metadata)."""
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    summaries = [_conversation_summary(user_id, conv_id) for conv_id in user_meta]
    summaries.sort(key=lambda s: s.updatedAt, reverse=True)
    return summaries


@app.get("/api/chat/conversations/{conversation_id}", response_model=ChatHistoryResponse)
def get_conversation(conversation_id: str, request: Request):
    """Return full message list for a conversation."""
    user_id = _get_user_id(request)
    user_messages = _get_user_message_store(user_id)
    if conversation_id not in user_messages:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return ChatHistoryResponse(messages=user_messages[conversation_id], conversationId=conversation_id)


@app.post("/api/chat/message", response_model=SendMessageResponse)
def chat_with_llm(req: SendMessageRequest, request: Request):
    """
    Handle a user message: store the user message, build a prompt from recent history,
    call the local LLM helper (backend.llm_model.generate_text), store the assistant reply,
    and return the assistant message to the frontend.
    """
    user_id = _get_user_id(request)
    message_text = req.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    # Ensure conversation exists, append the user message
    conversation_id = _ensure_conversation(user_id, req.conversationId, message_text)
    _store_message(user_id, conversation_id, "user", message_text)

    # Build a controlled prompt for the model
    prompt = _build_prompt(user_id, conversation_id)

    # Call the LLM helper.
    # Note: generate_text is expected to be synchronous and return a short string reply.
    # This implementation wraps errors into HTTPExceptions for clarity to the frontend.
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
        # Validation errors from the LLM helper (e.g., invalid parameters)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        # Generic failure (model call / infra) -> 500
        raise HTTPException(status_code=500, detail="LLM generation failed.")

    # Guard against empty replies
    if not reply_text:
        raise HTTPException(status_code=500, detail="Empty LLM reply.")

    # Clean the raw model reply to strip common sign‑offs
    clean_reply = strip_signature(reply_text).strip()

    assistant_message = _store_message(user_id, conversation_id, "assistant", clean_reply)
    return SendMessageResponse(message=assistant_message, conversationId=conversation_id)


@app.delete("/api/chat/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, request: Request):
    """Delete a conversation and its messages for the user."""
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    _get_user_message_store(user_id).pop(conversation_id, None)
    user_meta.pop(conversation_id, None)
    return {"message": "Conversation deleted."}


@app.delete("/api/chat/conversations/{conversation_id}/messages")
def clear_conversation_messages(conversation_id: str, request: Request):
    """Clear messages in a conversation without removing the conversation metadata."""
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    user_messages = _get_user_message_store(user_id)
    if conversation_id not in user_meta:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    user_messages[conversation_id] = []
    user_meta[conversation_id]["updated_at"] = datetime.utcnow()
    return {"message": "Conversation messages cleared."}


# --- Admin endpoints for diagnostics and settings (demo) ---

@app.get("/api/admin/stats")
def get_admin_stats(request: Request):
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    user_msgs = _get_user_message_store(user_id)
    total_conversations = len(user_meta)
    total_messages = sum(len(user_msgs.get(cid, [])) for cid in user_msgs)
    active_users = 1 if total_conversations > 0 else 0
    return {
        "totalUsers": 1,  # or len(global_metadata_store) if you track all users
        "totalConversations": total_conversations,
        "totalMessages": total_messages,
        "activeUsers": active_users,
    }



@app.get("/api/admin/users")
def get_admin_users():
    """
    Return a list of users derived from conversation_metadata.
    Note: This is a demo helper; in production use a proper user store.
    """
    users = []
    for user_id, metas in conversation_metadata.items():
        created_iso = (
            next(iter(metas.values()))["created_at"].isoformat()
            if metas
            else datetime.utcnow().isoformat()
        )
        users.append({
            "id": user_id,
            "name": user_id,
            "email": f"{user_id}@example.com",
            "role": "admin" if user_id == "admin" else "user",
            "createdAt": created_iso,
        })
    return users


# --- Admin models and endpoints (settings / test) ---

class AdminSettings(BaseModel):
    """Settings that the admin UI can read/write (demo only)."""
    model: str
    systemPrompt: str
    temperature: float
    maxTokens: int
    retrievalDepth: int
    rateLimit: int


# In-memory persisted admin settings for the lifetime of the process (demo)
admin_settings_store = AdminSettings(
    model="gpt-4o-mini",
    systemPrompt="You are an internal assistant. Answer concisely and follow safety policies.",
    temperature=0.2,
    maxTokens=1024,
    retrievalDepth=5,
    rateLimit=60,
)


class TestRequest(BaseModel):
    """Request shape used by admin test endpoint."""
    prompt: str
    settings: AdminSettings


class TestResponse(BaseModel):
    """Response shape returned by admin test endpoint."""
    output: str
    settings_used: AdminSettings


@app.get("/api/admin/settings", response_model=AdminSettings)
def get_admin_settings():
    """Return current admin settings (persisted for this process)."""
    return admin_settings_store


@app.post("/api/admin/settings", response_model=AdminSettings)
def update_admin_settings(settings: AdminSettings):
    """Persist and echo admin settings (demo-only persistence in-memory)."""
    global admin_settings_store
    admin_settings_store = settings
    return admin_settings_store


@app.get("/api/admin/test")
def admin_test_get():
    """Simple GET test endpoint used by the frontend to verify connectivity."""
    return {"status": "ok", "message": "Admin test GET endpoint working"}


@app.post("/api/admin/test", response_model=TestResponse)
def admin_test(req: TestRequest):
    """
    Admin test endpoint - validates prompt and echoes a response.
    Useful for verifying the settings form and basic request handling.
    """
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")
    return {
        "output": f"Echo: {req.prompt}",
        "settings_used": req.settings,
    }


# --- Entrypoint for local dev ---
if __name__ == "__main__":
    import uvicorn
    # Run the app for local development. Use `python -m uvicorn backend.main:app --reload` in production/dev flow.
    uvicorn.run(app, host="0.0.0.0", port=8000)
