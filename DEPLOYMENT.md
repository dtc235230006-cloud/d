# Triển khai Cloudflare Pages

Giao diện được triển khai dưới dạng file tĩnh trên Cloudflare Pages. Flask và phần xử lý dữ liệu vẫn chạy ở một dịch vụ Python riêng; không dùng Docker/Cloudflare Containers.

## Chạy ứng dụng Flask trên Windows

`app.py` là ứng dụng Flask, không phải ứng dụng Streamlit. Trong PowerShell tại thư mục dự án, chạy:

```powershell
.\.venv\Scripts\python.exe app.py
```

Sau đó mở `http://127.0.0.1:5001`. Nếu chưa có môi trường `.venv`, tạo môi trường và cài dependencies trước:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Đặt biến môi trường build `API_BASE_URL` thành URL công khai của dịch vụ Flask, ví dụ `https://api.example.com` (không có dấu `/` cuối).

Khi deploy thủ công bằng Wrangler, chạy `npm run deploy` và đặt `API_BASE_URL` trong môi trường terminal trước khi chạy.

## Dịch vụ Flask

Triển khai ứng dụng Python bằng dịch vụ có hỗ trợ Python trực tiếp, cài các gói trong `requirements.txt` và chạy:

```text
gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 300 app:app
```

Đặt biến môi trường `CORS_ALLOWED_ORIGIN` trên dịch vụ Flask thành đúng origin của Cloudflare Pages (ví dụ `https://giaodien.pages.dev`). Origin không có dấu `/` cuối. Nếu không cấu hình biến này, yêu cầu cùng origin vẫn hoạt động nhưng trình duyệt sẽ chặn yêu cầu từ Pages.
