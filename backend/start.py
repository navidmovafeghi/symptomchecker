#!/usr/bin/env python3
"""Startup script for Railway deployment."""
import os
import sys

def main():
    """Start the uvicorn server with proper port configuration."""
    port = os.environ.get("PORT", "8000")
    
    # Import uvicorn
    try:
        import uvicorn
    except ImportError:
        print("Error: uvicorn is not installed")
        sys.exit(1)
    
    # Run the app
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(port),
        log_level="info"
    )

if __name__ == "__main__":
    main()
