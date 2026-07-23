#!/usr/bin/env python3
"""Static server with Cache-Control: no-store (ES modules otherwise stick in Chrome's cache)."""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    handler = functools.partial(NoCacheHandler, directory=os.path.dirname(os.path.abspath(__file__)))
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
