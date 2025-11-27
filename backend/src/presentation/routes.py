"""API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from ..application.dtos import (
    SendMessageRequest,
    SendMessageResponse,
    ConversationResponse,
    ConversationListResponse
)
from ..application.use_cases import (
    SendMessageUseCase,
    GetConversationHistoryUseCase,
    DeleteConversationUseCase,
    ListConversationsUseCase
)
from ..domain.exceptions import ConversationNotFoundException, InvalidMessageException
from .dependencies import (
    get_send_message_use_case,
    get_conversation_history_use_case,
    get_delete_conversation_use_case,
    get_list_conversations_use_case
)


router = APIRouter(prefix="/api/chat")


@router.post("/message", response_model=SendMessageResponse)
async def send_message(
    request: SendMessageRequest,
    use_case: SendMessageUseCase = Depends(get_send_message_use_case)
):
    """Send a message and get a response (non-streaming)."""
    try:
        return await use_case.execute(request)
    except InvalidMessageException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConversationNotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@router.post("/message/stream")
async def send_message_stream(
    request: SendMessageRequest,
    use_case: SendMessageUseCase = Depends(get_send_message_use_case)
):
    """Send a message and stream the response."""
    try:
        async def generate():
            async for chunk in use_case.execute_stream(request):
                yield chunk

        return StreamingResponse(generate(), media_type="text/plain")
    except InvalidMessageException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConversationNotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


from ..application.dtos import ResumeConversationRequest, ResumeConversationResponse
from ..application.use_cases import ResumeConversationUseCase
from .dependencies import get_resume_conversation_use_case


@router.post("/resume", response_model=ResumeConversationResponse)
async def resume_conversation(
    request: ResumeConversationRequest,
    use_case: ResumeConversationUseCase = Depends(get_resume_conversation_use_case)
):
    """Resume an interrupted conversation with user's clarification."""
    try:
        return await use_case.execute(request)
    except InvalidMessageException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConversationNotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resume error: {str(e)}")


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    use_case: ListConversationsUseCase = Depends(get_list_conversations_use_case)
):
    """List all conversations."""
    try:
        return await use_case.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    use_case: GetConversationHistoryUseCase = Depends(get_conversation_history_use_case)
):
    """Get conversation history."""
    try:
        return await use_case.execute(conversation_id)
    except ConversationNotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    use_case: DeleteConversationUseCase = Depends(get_delete_conversation_use_case)
):
    """Delete a conversation."""
    try:
        deleted = await use_case.execute(conversation_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"status": "success", "message": "Conversation deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")
