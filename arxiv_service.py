"""
ImgML — arXiv Search Service

Provides search and PDF download functionality using the official arXiv API.
Includes rate limiting, caching, and error handling.
"""

import os
import re
import time
import threading
import xml.etree.ElementTree as ET
from urllib.parse import urlencode, quote
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


# --- arXiv API Configuration ---
ARXIV_API_BASE = "http://export.arxiv.org/api/query"
ARXIV_PDF_BASE = "https://arxiv.org/pdf"
ARXIV_ABS_BASE = "https://arxiv.org/abs"

# Atom/OpenSearch namespaces
NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'arxiv': 'http://arxiv.org/schemas/atom',
    'opensearch': 'http://a9.com/-/spec/opensearch/1.1/',
}

# --- Rate Limiter ---
class RateLimiter:
    """Thread-safe rate limiter with configurable minimum interval."""

    def __init__(self, min_interval_seconds=3.0):
        self.min_interval = min_interval_seconds
        self._last_call_time = 0
        self._lock = threading.Lock()

    def wait(self):
        """Block until enough time has elapsed since the last call."""
        with self._lock:
            now = time.time()
            elapsed = now - self._last_call_time
            if elapsed < self.min_interval:
                wait_time = self.min_interval - elapsed
                time.sleep(wait_time)
            self._last_call_time = time.time()


# Global rate limiters
_api_limiter = RateLimiter(min_interval_seconds=3.0)  # 3s between API calls
_pdf_limiter = RateLimiter(min_interval_seconds=1.0)   # 1s between PDF downloads


# --- Simple In-Memory Cache ---
class SimpleCache:
    """Thread-safe in-memory cache with TTL."""

    def __init__(self, ttl_seconds=300):
        self.ttl = ttl_seconds
        self._store = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key in self._store:
                value, timestamp = self._store[key]
                if time.time() - timestamp < self.ttl:
                    return value
                else:
                    del self._store[key]
        return None

    def set(self, key, value):
        with self._lock:
            self._store[key] = (value, time.time())
            # Evict old entries if cache grows too large
            if len(self._store) > 100:
                self._evict()

    def _evict(self):
        now = time.time()
        expired = [k for k, (_, ts) in self._store.items()
                   if now - ts >= self.ttl]
        for k in expired:
            del self._store[k]


_search_cache = SimpleCache(ttl_seconds=300)  # 5-minute TTL


# --- API Functions ---

def search_arxiv(query, start=0, max_results=10, sort_by="submittedDate",
                 sort_order="descending"):
    """
    Search arXiv using the official API.

    Args:
        query: Search keyword string.
        start: Index of first result (for pagination).
        max_results: Maximum number of results (1-50).
        sort_by: One of "relevance", "lastUpdatedDate", "submittedDate".
        sort_order: "ascending" or "descending".

    Returns:
        dict with keys:
            - total_results (int)
            - start (int)
            - papers (list of paper dicts)
            - query (str)

    Raises:
        Exception on API errors or network issues.
    """
    # Clamp max_results
    max_results = max(1, min(200, max_results))

    # Check cache
    cache_key = f"{query}|{start}|{max_results}|{sort_by}|{sort_order}"
    cached = _search_cache.get(cache_key)
    if cached:
        return cached

    # Build API URL
    params = {
        'search_query': f'all:{query}',
        'start': str(start),
        'max_results': str(max_results),
        'sortBy': sort_by,
        'sortOrder': sort_order,
    }
    url = f"{ARXIV_API_BASE}?{urlencode(params)}"

    # Rate limit
    _api_limiter.wait()

    # Make request
    try:
        req = Request(url, headers={
            'User-Agent': 'ImgML/1.0 (Research Paper Image Extractor)'
        })
        with urlopen(req, timeout=30) as response:
            xml_data = response.read().decode('utf-8')
    except HTTPError as e:
        if e.code == 429:
            raise Exception("arXiv rate limit exceeded. Please wait a moment and try again.")
        raise Exception(f"arXiv API error: HTTP {e.code}")
    except URLError as e:
        raise Exception(f"Network error reaching arXiv: {str(e.reason)}")
    except Exception as e:
        raise Exception(f"Failed to query arXiv: {str(e)}")

    # Parse Atom XML
    result = _parse_atom_response(xml_data, query)

    # Cache result
    _search_cache.set(cache_key, result)

    return result


def _parse_atom_response(xml_data, query):
    """Parse arXiv Atom XML response into structured data."""
    root = ET.fromstring(xml_data)

    # Extract total results count
    total_el = root.find('opensearch:totalResults', NS)
    total_results = int(total_el.text) if total_el is not None else 0

    start_el = root.find('opensearch:startIndex', NS)
    start_index = int(start_el.text) if start_el is not None else 0

    papers = []
    for entry in root.findall('atom:entry', NS):
        paper = _parse_entry(entry)
        if paper:
            papers.append(paper)

    return {
        'total_results': total_results,
        'start': start_index,
        'papers': papers,
        'query': query,
    }


def _parse_entry(entry):
    """Parse a single Atom entry into a paper dict."""
    try:
        # ID (extract arXiv ID from URL)
        id_text = entry.find('atom:id', NS).text.strip()
        arxiv_id = id_text.split('/abs/')[-1]
        # Remove version suffix for cleaner display
        arxiv_id_base = re.sub(r'v\d+$', '', arxiv_id)

        # Title
        title_el = entry.find('atom:title', NS)
        title = ' '.join(title_el.text.strip().split()) if title_el is not None else 'Untitled'

        # Abstract/Summary
        summary_el = entry.find('atom:summary', NS)
        abstract = ' '.join(summary_el.text.strip().split()) if summary_el is not None else ''

        # Authors
        authors = []
        for author_el in entry.findall('atom:author', NS):
            name_el = author_el.find('atom:name', NS)
            if name_el is not None:
                authors.append(name_el.text.strip())

        # Published date
        published_el = entry.find('atom:published', NS)
        published = published_el.text.strip()[:10] if published_el is not None else ''

        # Updated date
        updated_el = entry.find('atom:updated', NS)
        updated = updated_el.text.strip()[:10] if updated_el is not None else ''

        # Categories
        categories = []
        for cat_el in entry.findall('atom:category', NS):
            term = cat_el.get('term', '')
            if term:
                categories.append(term)

        # PDF link
        pdf_url = f"{ARXIV_PDF_BASE}/{arxiv_id_base}"

        # Abstract page link
        abs_url = f"{ARXIV_ABS_BASE}/{arxiv_id_base}"

        # Links from entry
        for link_el in entry.findall('atom:link', NS):
            if link_el.get('title') == 'pdf':
                pdf_url = link_el.get('href', pdf_url)

        # Comment (often contains page count)
        comment_el = entry.find('arxiv:comment', NS)
        comment = comment_el.text.strip() if comment_el is not None else ''

        # Primary category
        primary_cat_el = entry.find('arxiv:primary_category', NS)
        primary_category = primary_cat_el.get('term', '') if primary_cat_el is not None else ''

        return {
            'arxiv_id': arxiv_id_base,
            'title': title,
            'abstract': abstract,
            'authors': authors,
            'published': published,
            'updated': updated,
            'categories': categories,
            'primary_category': primary_category,
            'pdf_url': pdf_url,
            'abs_url': abs_url,
            'comment': comment,
        }

    except Exception:
        return None


def download_pdf(arxiv_id, dest_dir):
    """
    Download a PDF from arXiv.

    Args:
        arxiv_id: arXiv paper ID (e.g., '2301.12345').
        dest_dir: Directory to save the PDF.

    Returns:
        Path to the downloaded PDF file.

    Raises:
        Exception on download failure.
    """
    os.makedirs(dest_dir, exist_ok=True)

    pdf_url = f"{ARXIV_PDF_BASE}/{arxiv_id}"
    safe_filename = arxiv_id.replace('/', '_') + '.pdf'
    filepath = os.path.join(dest_dir, safe_filename)

    # Skip if already downloaded
    if os.path.exists(filepath) and os.path.getsize(filepath) > 1000:
        return filepath

    # Rate limit
    _pdf_limiter.wait()

    # Download with retries
    max_retries = 3
    for attempt in range(max_retries):
        try:
            req = Request(pdf_url, headers={
                'User-Agent': 'ImgML/1.0 (Research Paper Image Extractor)',
                'Accept': 'application/pdf',
            })
            with urlopen(req, timeout=60) as response:
                content_type = response.headers.get('Content-Type', '')

                # Follow redirect if we get HTML instead of PDF
                if 'html' in content_type.lower():
                    # arXiv sometimes serves an HTML page first
                    raise Exception("Got HTML instead of PDF, retrying...")

                pdf_data = response.read()

                if len(pdf_data) < 1000:
                    raise Exception("Downloaded file too small, likely not a valid PDF")

                with open(filepath, 'wb') as f:
                    f.write(pdf_data)

                return filepath

        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))  # Exponential backoff
                continue
            raise Exception(f"Failed to download PDF for {arxiv_id} after "
                           f"{max_retries} attempts: {str(e)}")


def get_paper_display_name(paper):
    """Generate a clean display name for a paper."""
    # Use first 60 chars of title, sanitized for filenames
    title = paper.get('title', paper.get('arxiv_id', 'paper'))
    safe_title = re.sub(r'[^\w\s\-]', '', title).strip()
    safe_title = re.sub(r'\s+', '_', safe_title)
    if len(safe_title) > 60:
        safe_title = safe_title[:60].rstrip('_')
    return f"{safe_title}_{paper['arxiv_id'].replace('/', '_')}"
