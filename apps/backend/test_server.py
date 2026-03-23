#!/usr/bin/env python3
"""Test script to run the server."""

import os
import sys
import traceback

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    print("Importing main module...")
    from agent_api.main import app
    print("✓ Main module imported successfully")
    
    print("Starting server...")
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")
    
except Exception as e:
    print(f"❌ Error: {e}")
    traceback.print_exc()
