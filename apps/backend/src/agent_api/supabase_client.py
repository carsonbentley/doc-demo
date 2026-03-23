"""
Supabase client for the AI API.
"""
import os
import httpx
from dotenv import load_dotenv
from typing import Optional, Dict, Any, List

# Load environment variables from .env file
load_dotenv()

class SimpleSupabaseClient:
    """Simple Supabase client that only handles table operations."""

    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.key = key
        self.headers = {
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Prefer': 'return=representation'
        }

    def table(self, table_name: str):
        """Get a table interface."""
        return TableInterface(self, table_name)

class TableInterface:
    """Interface for table operations."""

    def __init__(self, client: SimpleSupabaseClient, table_name: str):
        self.client = client
        self.table_name = table_name
        self.base_url = f"{client.url}/rest/v1/{table_name}"

    def select(self, columns: str = "*"):
        """Select columns from table."""
        return QueryBuilder(self.client, self.base_url, 'GET', columns)

    def insert(self, data: Dict[str, Any]):
        """Insert data into table."""
        return QueryBuilder(self.client, self.base_url, 'POST', data=data)

    def upsert(self, data: Dict[str, Any]):
        """Upsert data into table."""
        headers = {**self.client.headers, 'Prefer': 'resolution=merge-duplicates,return=representation'}
        return QueryBuilder(self.client, self.base_url, 'POST', data=data, headers=headers)

    def delete(self):
        """Delete from table."""
        return QueryBuilder(self.client, self.base_url, 'DELETE')

class QueryBuilder:
    """Query builder for Supabase operations."""

    def __init__(self, client: SimpleSupabaseClient, url: str, method: str, columns: str = None, data: Any = None, headers: Dict[str, str] = None):
        self.client = client
        self.url = url
        self.method = method
        self.columns = columns
        self.data = data
        self.headers = headers or client.headers
        self.filters = []

    def eq(self, column: str, value: Any):
        """Add equality filter."""
        self.filters.append(f"{column}=eq.{value}")
        return self

    def single(self):
        """Return single result."""
        self.headers = {**self.headers, 'Accept': 'application/vnd.pgrst.object+json'}
        return self

    def order(self, column: str, desc: bool = False):
        """Add ordering."""
        direction = 'desc' if desc else 'asc'
        self.filters.append(f"order={column}.{direction}")
        return self

    def limit(self, count: int):
        """Add limit."""
        self.filters.append(f"limit={count}")
        return self

    def execute(self):
        """Execute the query."""
        url = self.url
        if self.columns and self.method == 'GET':
            url += f"?select={self.columns}"
            if self.filters:
                url += "&" + "&".join(self.filters)
        elif self.filters:
            url += "?" + "&".join(self.filters)

        with httpx.Client() as client:
            if self.method == 'GET':
                response = client.get(url, headers=self.headers)
            elif self.method == 'POST':
                response = client.post(url, headers=self.headers, json=self.data)
            elif self.method == 'DELETE':
                response = client.delete(url, headers=self.headers)
            else:
                raise ValueError(f"Unsupported method: {self.method}")

        response.raise_for_status()

        # Return a simple result object
        return SimpleResult(response.json() if response.content else None)

class SimpleResult:
    """Simple result wrapper."""

    def __init__(self, data: Any):
        self.data = data

def get_supabase_client():
    """Get Supabase client instance."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    return SimpleSupabaseClient(url, key)

# Global client instance
_client: Optional[SimpleSupabaseClient] = None

def get_client() -> SimpleSupabaseClient:
    """Get or create global Supabase client."""
    global _client
    if _client is None:
        _client = get_supabase_client()
    return _client
