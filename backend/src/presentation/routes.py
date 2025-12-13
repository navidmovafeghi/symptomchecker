"""API routes."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from ..application.dtos import (
    SendMessageRequest,
    SendMessageResponse,
    ResumeConversationRequest,
    ResumeConversationResponse
)
from ..application.use_cases import (
    SendMessageUseCase,
    DeleteCheckpointUseCase,
    ResumeConversationUseCase
)
from ..domain.exceptions import InvalidMessageException, CheckpointNotFoundException
from .dependencies import (
    get_send_message_use_case,
    get_delete_checkpoint_use_case,
    get_resume_conversation_use_case
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


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
    except CheckpointNotFoundException as e:
        raise HTTPException(
            status_code=404, 
            detail=f"Checkpoint expired: {str(e)}. The server session has expired and cannot be resumed."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resume error: {str(e)}")


@router.post("/resume/stream")
async def resume_conversation_stream(
    request: ResumeConversationRequest,
    use_case: ResumeConversationUseCase = Depends(get_resume_conversation_use_case)
):
    """Resume an interrupted conversation with streaming stage indicators."""
    try:
        async def generate():
            async for chunk in use_case.execute_stream(request):
                yield chunk

        return StreamingResponse(generate(), media_type="text/plain")
    except InvalidMessageException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except CheckpointNotFoundException as e:
        raise HTTPException(
            status_code=404, 
            detail=f"Checkpoint expired: {str(e)}. The server session has expired and cannot be resumed."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resume stream error: {str(e)}")


@router.delete("/checkpoints/{thread_id}")
async def delete_checkpoint(
    thread_id: str,
    use_case: DeleteCheckpointUseCase = Depends(get_delete_checkpoint_use_case)
):
    """Delete only the server checkpoint for a conversation.
    
    This endpoint is used when conversations are stored client-side (IndexedDB)
    and we only need to clean up the server checkpoint data.
    The thread_id is the same as the conversation_id.
    """
    try:
        deleted = await use_case.execute(thread_id)
        if not deleted:
            return {"status": "success", "message": "Checkpoint not found or already deleted"}
        return {"status": "success", "message": "Checkpoint deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")
