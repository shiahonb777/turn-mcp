import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../python-client'))
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout, TurnMcpCanceled
client = TurnMcpClient('http://127.0.0.1:3737')

async def main() -> None:
    print('Asking for human approval...')
    try:
        reply = await client.async_wait(context="I've analysed the codebase and identified 3 files to delete:\n  - src/legacy/old_auth.py (unused since 2022)\n  - docs/legacy-api.md (superseded)\n  - scripts/migrate_v1.sh (migration already ran)", question='Should I delete these files?', options=['Yes, delete them', 'No, keep them', 'Show me the files first'], agent_name='CleanupAgent')
        print(f'Human replied: {reply!r}')
    except TurnMcpTimeout:
        print('Nobody responded — skipping cleanup.')
    except TurnMcpCanceled:
        print('Cleanup was canceled.')
if __name__ == '__main__':
    asyncio.run(main())
