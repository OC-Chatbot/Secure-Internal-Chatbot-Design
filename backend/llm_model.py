# backend/llm_model.py

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
import os
import sys

print("[llm_model] sys.executable:", sys.executable)
print("[llm_model] CUDA_VISIBLE_DEVICES:",
      os.environ.get("CUDA_VISIBLE_DEVICES"))
print("[llm_model] torch version:", torch.__version__)
print("[llm_model] torch.version.cuda:", torch.version.cuda)
print("[llm_model] torch.cuda.is_available():", torch.cuda.is_available())

# Small but modern chat model
MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"

if torch.cuda.is_available():
    DEVICE = "cuda"
    MODEL_KWARGS = {"torch_dtype": torch.float16}
elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    DEVICE = "mps"
    MODEL_KWARGS = {"torch_dtype": torch.float16}
else:
    DEVICE = "cpu"
    MODEL_KWARGS = {}

print(f"[llm_model] Using device: {DEVICE}")

# Use fast tokenizer (no sentencepiece python package needed)
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, use_fast=True)

# Ensure we have a pad token
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME, **MODEL_KWARGS).to(DEVICE)

model.eval()

# ---------------------------------------------------------------------------
# System prompt for the OCE&E chatbot
# TinyLlama-1.1B-Chat uses the ChatML / zephyr template:
#   <|system|>\n{system}</s>\n<|user|>\n{user}</s>\n<|assistant|>\n
# Injecting the system prompt here once keeps it out of every call-site.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are the virtual assistant for the North Seattle College Opportunity Center for Employment & Education (OCE&E). Your only job is to help students, visitors, and community members get accurate information about the OCE&E's services, hours, location, and contacts.

SERVICES YOU KNOW ABOUT:

General
- Address: 9600 College Way N, Seattle, WA 98103 (North Seattle College campus)
- General contact: OpportunityCenterNSC@seattlecolleges.edu | (206) 934-6147
- Integration Manager: Kathleen Cromp | kathleen.cromp@seattlecolleges.edu | (206) 934-6077

Workforce Education (Tuition Assistance)
- Helps eligible students with tuition and fees
- Location: OC0240A (2nd floor) | Hours: Mon-Thu 8:30am-5pm, Fri virtual only, Drop-in Tue 1-4pm
- Contact: (206) 934-3787 | nworkforce@seattlecolleges.edu | northseattle.edu/workforce-education

Employment Services (WorkSource)
- Resume help, job search, interview prep, career workshops
- WorkSource Resource Area: 1st Floor Lobby | Hours: Mon-Fri 8am-5pm
- Appointments: (206) 440-2500 | WorkSourcewa.com

Social Services (DSHS & Partners)
- Psychiatric services, child and family support, nursing, family planning, domestic violence advocacy
- Location: OC0123 (1st floor) | DSHS contact: (206) 341-7000
- YWCA Domestic Violence: ywcaworks.org

Health & Benefits Assistance
- Healthcare Navigator Claudia Sierra: Thursdays 9am-12pm and 1-4pm (first come, first served)
- Contact: claudia.sierra@kingcounty.gov | (206) 477-7272
- CHAP: (206) 284-0331 or 1-800-756-5437
- Help with: health insurance, ORCA LIFT, utility assistance

Financial Literacy
- Workshops on banking, debt management, and student loans
- Express Credit Union available Thursdays for account setup

RULES YOU MUST FOLLOW:
1. Only answer questions about the OCE&E. If asked about anything unrelated, respond: "I can only help with questions about the Opportunity Center. For other questions, please visit northseattle.edu or call (206) 934-6147."
2. Never invent information. If unsure, say: "I don't have that detail — please contact us at (206) 934-6147 or OpportunityCenterNSC@seattlecolleges.edu."
3. Keep answers short, clear, and friendly.
4. Always include a relevant contact or next step at the end of your answer."""


def _build_prompt(user_message: str) -> str:
    """
    Wraps the user message in TinyLlama's native ChatML template so the
    instruction-tuned weights are properly activated.

    Format:
        <|system|>
        {system}</s>
        <|user|>
        {user}</s>
        <|assistant|>
    """
    return (
        f"<|system|>\n{SYSTEM_PROMPT}</s>\n"
        f"<|user|>\n{user_message.strip()}</s>\n"
        f"<|assistant|>\n"
    )


def generate_text(
    prompt: str,
    max_new_tokens: int = 300,
    temperature: float = 0.4,
    top_p: float = 0.9,
    do_sample: bool = True,
    repetition_penalty: float = 1.1,
    wrap_prompt: bool = True,
    strip_after: str | None = None,
) -> str:
    """
    Generate a chatbot response for a user message.

    Args:
        prompt:            The raw user message (plain text, no template needed)
                           or a fully pre-built prompt when wrap_prompt=False.
        max_new_tokens:    Max tokens to generate. 200 gives room for a full answer.
        temperature:       Lower = more focused/deterministic. 0.4 is a safe default.
        top_p:             Nucleus sampling cutoff.
        do_sample:         True enables sampling; set False for fully greedy decoding.
        repetition_penalty: >1.0 discourages the model from repeating itself.
        wrap_prompt:       When True (default), wraps prompt in the ChatML template.
                           Set False when the caller already built the full prompt.
        strip_after:       If provided, strips the response up to and including this
                           prefix (e.g. "Answer:" removes that label from the output).

    Returns:
        The assistant's reply as a plain string.
    """
    if not prompt:
        raise ValueError("Prompt must not be empty.")

    full_prompt = _build_prompt(prompt) if wrap_prompt else prompt
    inputs = tokenizer(full_prompt, return_tensors="pt").to(DEVICE)

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            do_sample=do_sample,
            repetition_penalty=repetition_penalty,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    # Decode only the newly generated tokens (skip the prompt)
    new_tokens = output_ids[0][inputs["input_ids"].shape[-1]:]
    response = tokenizer.decode(new_tokens, skip_special_tokens=True)

    if strip_after and strip_after in response:
        response = response[response.index(strip_after) + len(strip_after):]

    return response.strip()
