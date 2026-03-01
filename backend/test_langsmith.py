"""
Standalone LangSmith diagnostic — runs OUTSIDE FastAPI/uvicorn.
If traces appear from this script but not from the server, the issue
is the background tracing thread dying inside uvicorn.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

if os.environ.get("LANGSMITH_API_KEY") and not os.environ.get("LANGCHAIN_API_KEY"):
    os.environ["LANGCHAIN_API_KEY"] = os.environ["LANGSMITH_API_KEY"]
if os.environ.get("LANGSMITH_TRACING") and not os.environ.get("LANGCHAIN_TRACING_V2"):
    os.environ["LANGCHAIN_TRACING_V2"] = os.environ["LANGSMITH_TRACING"]

print("=== ENV CHECK ===")
for k in ["LANGSMITH_TRACING", "LANGSMITH_API_KEY", "LANGSMITH_PROJECT",
           "LANGSMITH_ENDPOINT", "LANGCHAIN_API_KEY", "LANGCHAIN_TRACING_V2"]:
    v = os.environ.get(k, "(not set)")
    display = (v[:12] + "...") if len(v) > 15 else v
    print(f"  {k} = {display}")

import langsmith as ls
from langsmith import Client, traceable

client = Client()

print("\n=== API CHECK ===")
try:
    projects = list(client.list_projects(limit=3))
    print(f"  API key valid — found {len(projects)} project(s):")
    for p in projects:
        print(f"    - {p.name}")
except Exception as e:
    print(f"  API check FAILED: {e}")
    exit(1)

print("\n=== TRACE TEST 1: @traceable with tracing_context ===")

@traceable(name="diagnostic-ping", run_type="chain")
def ping(msg: str) -> str:
    return f"pong: {msg}"

project = os.environ.get("LANGSMITH_PROJECT", "default")
with ls.tracing_context(enabled=True, project_name=project):
    result = ping("standalone test")
    print(f"  Function returned: {result}")

print("  Flushing traces...")
client.flush()
print("  Flush complete.")

print("\n=== TRACE TEST 2: langsmith.trace() context manager ===")
with ls.trace(name="diagnostic-trace-cm", run_type="chain", project_name=project) as rt:
    rt.outputs = {"result": "context-manager test worked"}
    print(f"  Run ID: {rt.id}")

print("  Flushing traces...")
client.flush()
print("  Flush complete.")

print("\n=== DONE ===")
print(f"Check project '{project}' at https://smith.langchain.com")
print("Look for 'diagnostic-ping' and 'diagnostic-trace-cm' traces.")
