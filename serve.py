# 本機伺服器：跟 python -m http.server 一樣，但告訴瀏覽器不要快取，
# 這樣改完程式重新整理就一定拿到最新版（避免看到舊版本）。
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
root = os.path.dirname(os.path.abspath(__file__))
handler = functools.partial(NoCacheHandler, directory=root)
print(f'打擊操作基底：http://localhost:{port}/  （關掉這個視窗就會停止）')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
