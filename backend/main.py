### Complete revised backend/main.py

#--- python ---
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.llm_model import generate_text

# --- App setup ---
app = FastAPI(title="Opportunity Center Chat Backend", version="1.0.0")

# Health check
@app.get("/__health")
def health():
    return {"status": "ok"}

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models ---
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

class ChatHistoryResponse(BaseModel):
    messages: List[ChatMessage]
    conversationId: str

# --- Data stores ---
conversation_messages: dict[str, dict[str, list[ChatMessage]]] = {}
conversation_metadata: dict[str, dict[str, dict[str, datetime | str]]] = {}

# --- Helpers ---
def _get_user_id(request: Request) -> str:
    return request.headers.get("x-user-id") or "admin"

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

def _ensure_conversation(user_id: str, conversation_id: Optional[str], user_message: str) -> str:
    user_meta = _get_user_metadata_store(user_id)
    if conversation_id and conversation_id in user_meta:
        return conversation_id
    return _create_conversation(user_id, user_message)

def _store_message(user_id: str, conversation_id: str, role: Literal["user", "assistant"], content: str) -> ChatMessage:
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
    latest_user = next((msg for msg in reversed(recent_history) if msg.role == "user"), None)
    latest_content = latest_user.content if latest_user else ""

    system = (
        "You are a helpful assistant for the Opportunity Center. "
        "Provide a single concise answer to the most recent user question. "
        "Do not invent or ask questions. Reply with only the answer text, no prefixes or labels. "
        "Keep replies under 80 words."
    )

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
    return ChatHistoryResponse(messages=user_messages[conversation_id], conversationId=conversation_id)

@app.post("/api/chat/message", response_model=SendMessageResponse)
def chat_with_llm(req: SendMessageRequest, request: Request):
    user_id = _get_user_id(request)
    message_text = req.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    conversation_id = _ensure_conversation(user_id, req.conversationId, message_text)
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
    return SendMessageResponse(message=assistant_message, conversationId=conversation_id)

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

@app.get("/api/admin/stats")
def get_admin_stats(request: Request):
    user_id = _get_user_id(request)
    user_meta = _get_user_metadata_store(user_id)
    user_msgs = _get_user_message_store(user_id)
    total_conversations = len(user_meta)
    total_messages = sum(len(user_msgs.get(cid, [])) for cid in user_msgs)
    active_users = 1 if total_conversations > 0 else 0
    return {
        "totalUsers": len(conversation_metadata),
        "totalConversations": total_conversations,
        "totalMessages": total_messages,
        "activeUsers": active_users,
    }

@app.get("/api/admin/users")
def get_admin_users():
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

# --- Admin Models ---
class AdminSettings(BaseModel):
    model: str
    systemPrompt: str
    temperature: float
    maxTokens: int
    retrievalDepth: int
    rateLimit: int

class TestRequest(BaseModel):
    prompt: str
    settings: AdminSettings

class TestResponse(BaseModel):
    output: str
    settings_used: AdminSettings

# --- Admin Endpoints ---
@app.get("/api/admin/settings", response_model=AdminSettings)
def get_admin_settings():
    return AdminSettings(
        model="gpt-4o-mini",
        systemPrompt="You are an internal assistant. Answer concisely and follow safety policies.",
        temperature=0.2,
        maxTokens=1024,
        retrievalDepth=5,
        rateLimit=60,
    )

@app.post("/api/admin/settings", response_model=AdminSettings)
def update_admin_settings(settings: AdminSettings):
    return settings

@app.get("/api/admin/test")
def admin_test_get():
    return {"status": "ok", "message": "Admin test GET endpoint working"}

@app.post("/api/admin/test", response_model=TestResponse)
def admin_test(req: TestRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")
    return {
        "output": f"Echo: {req.prompt}",
        "settings_used": req.settings,
    }


# --- Entrypoint ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
