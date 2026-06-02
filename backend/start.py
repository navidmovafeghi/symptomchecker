#!/usr/bin/env python3
"""Startup script for Railway deployment."""
import os
import sys

def main():
    """Start the uvicorn server with proper port configuration."""
    port = os.environ.get("PORT", "8000")
    
    # Check required environment variables
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY environment variable is not set!")
        print("Please set it in Railway Dashboard -> Variables")
        sys.exit(1)
    
    print(f"Starting server on port {port}")
    print(f"Railway PORT env: {os.environ.get('PORT', 'NOT SET')}")
    print(f"ANTHROPIC_API_KEY: {'✓ Set' if os.environ.get('ANTHROPIC_API_KEY') else '✗ Missing'}")
    print(f"CORS_ORIGINS: {os.environ.get('CORS_ORIGINS', 'Not set')}")
    print(f"CHECKPOINT_DB_PATH: {os.environ.get('CHECKPOINT_DB_PATH', 'checkpoints.db')}")
    
    # Import uvicorn
    try:
        import uvicorn
    except ImportError:
        print("Error: uvicorn is not installed")
        sys.exit(1)
    
    # Import the app to make sure it loads
    try:
        from main import app
        print("Successfully imported app from main.py")
    except Exception as e:
        print(f"Error importing app: {e}")
        sys.exit(1)
    
    # Run the app
    print(f"Starting uvicorn on 0.0.0.0:{port}")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(port),
        log_level="info"
    )

if __name__ == "__main__":
    main()
