#!/usr/bin/env python3
"""Startup script for Railway deployment."""
import os
import sys

def main():
    """Start the uvicorn server with proper port configuration."""
    port = os.environ.get("PORT", "8000")
    
    # Debug: Print all environment variables (safely)
    print("=" * 50)
    print("ENVIRONMENT CHECK")
    print("=" * 50)
    print(f"PORT: {port}")
    print(f"ANTHROPIC_API_KEY: {'✓ Set' if os.environ.get('ANTHROPIC_API_KEY') else '✗ Missing'}")
    print(f"CORS_ORIGINS: {os.environ.get('CORS_ORIGINS', 'Not set - will use default')}")
    print(f"CHECKPOINT_DB_PATH: {os.environ.get('CHECKPOINT_DB_PATH', 'checkpoints.db')}")
    print("=" * 50)
    
    # Warning if API key not set, but don't exit (let the app handle it)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("WARNING: ANTHROPIC_API_KEY environment variable is not set!")
        print("The application may not work correctly without it.")
        print("Please set it in Railway Dashboard -> Variables")
    
    # Import uvicorn
    try:
        import uvicorn
        print("✓ uvicorn imported successfully")
    except ImportError as e:
        print(f"✗ Error: uvicorn is not installed: {e}")
        sys.exit(1)
    
    # Import the app to make sure it loads
    try:
        from main import app
        print("✓ Successfully imported app from main.py")
    except Exception as e:
        print(f"✗ Error importing app: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    # Run the app
    print(f"Starting uvicorn server on 0.0.0.0:{port}")
    print("=" * 50)
    
    try:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=int(port),
            log_level="info"
        )
    except Exception as e:
        print(f"✗ Error starting server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
