import io
import os
import time
import logging
from typing import List, Optional
from flask import Flask, jsonify, render_template, request, send_file
import pandas as pd
from werkzeug.utils import secure_filename
from ml_engine import ExamDataProcessor

# Cấu hình logging chuyên nghiệp
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Giới hạn kích thước file upload tối đa: 100MB
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024
ALLOWED_EXTENSIONS = {'csv', 'xlsx', 'xls'}

# Danh mục 34 tỉnh/thành phố chuẩn hóa sau sáp nhập
PROVINCES_DICT = {
    '01': 'Thành phố Hà Nội', '04': 'Tỉnh Cao Bằng', '08': 'Tỉnh Tuyên Quang',
    '11': 'Tỉnh Điện Biên', '12': 'Tỉnh Lai Châu', '14': 'Tỉnh Sơn La',
    '15': 'Tỉnh Lào Cai', '19': 'Tỉnh Thái Nguyên', '20': 'Tỉnh Lạng Sơn',
    '22': 'Tỉnh Quảng Ninh', '24': 'Tỉnh Bắc Ninh', '25': 'Tỉnh Phú Thọ',
    '31': 'Thành phố Hải Phòng', '33': 'Tỉnh Hưng Yên', '37': 'Tỉnh Ninh Bình',
    '38': 'Tỉnh Thanh Hóa', '40': 'Tỉnh Nghệ An', '42': 'Tỉnh Hà Tĩnh',
    '44': 'Tỉnh Quảng Trị', '46': 'Thành phố Huế', '48': 'Thành phố Đà Nẵng',
    '51': 'Tỉnh Quảng Ngãi', '52': 'Tỉnh Gia Lai', '56': 'Tỉnh Khánh Hòa',
    '66': 'Tỉnh Đắk Lắk', '68': 'Tỉnh Lâm Đồng', '75': 'Tỉnh Đồng Nai',
    '79': 'Thành phố Hồ Chí Minh', '80': 'Tỉnh Tây Ninh', '82': 'Tỉnh Đồng Tháp',
    '86': 'Tỉnh Vĩnh Long', '91': 'Tỉnh An Giang', '92': 'Thành phố Cần Thơ',
    '96': 'Tỉnh Cà Mau'
}

# Khởi tạo lõi khai phá dữ liệu
processor = ExamDataProcessor(PROVINCES_DICT)


def is_allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def load_dataframe(file_storage, nrows: Optional[int] = None, target_cols: Optional[List[str]] = None) -> pd.DataFrame:
    """
    Hàm đọc file thông minh:
    - Cascading Encodings: Thử tuần tự UTF-8-SIG -> UTF-8 -> CP1258 (Tiếng Việt Windows) -> Latin1.
    - Xử lý triệt để khoảng trắng thừa trong tiêu đề cột (strip headers) tránh lỗi usecols mismatch.
    - Tối ưu I/O: Chỉ trích xuất các cột cần thiết để tiết kiệm 80-90% RAM.
    """
    filename = file_storage.filename.lower()
    file_storage.seek(0)

    if filename.endswith('.csv'):
        encodings = ['utf-8-sig', 'utf-8', 'cp1258', 'latin1']
        df = None
        last_error = None

        for enc in encodings:
            try:
                file_storage.seek(0)
                # Đọc trước hàng đầu tiên để chuẩn hóa tên cột
                preview_header = pd.read_csv(file_storage, nrows=0, encoding=enc)
                raw_cols = list(preview_header.columns)
                clean_cols_map = {str(c).strip(): c for c in raw_cols}

                actual_usecols = None
                if target_cols:
                    actual_usecols = [clean_cols_map[col] for col in target_cols if col in clean_cols_map]

                file_storage.seek(0)
                df = pd.read_csv(file_storage, nrows=nrows, usecols=actual_usecols, encoding=enc, low_memory=False)
                break
            except Exception as e:
                last_error = e
                continue

        if df is None:
            raise ValueError(f"Không thể đọc file CSV bằng các bảng mã phổ biến. Chi tiết lỗi: {last_error}")

    elif filename.endswith(('.xls', '.xlsx')):
        file_storage.seek(0)
        preview_header = pd.read_excel(file_storage, nrows=0)
        raw_cols = list(preview_header.columns)
        clean_cols_map = {str(c).strip(): c for c in raw_cols}

        actual_usecols = None
        if target_cols:
            actual_usecols = [clean_cols_map[col] for col in target_cols if col in clean_cols_map]

        file_storage.seek(0)
        df = pd.read_excel(file_storage, nrows=nrows, usecols=actual_usecols)
    else:
        raise ValueError("Định dạng file không được hỗ trợ. Vui lòng chọn .csv, .xlsx hoặc .xls")

    # Chuẩn hóa tên cột đầu ra: xóa khoảng trắng hai đầu
    df.columns = [str(col).strip() for col in df.columns]
    return df


@app.route('/')
def index():
    return render_template('index.html')


@app.get('/healthz')
def health_check():
    return jsonify({'status': 'ok'})


@app.route('/api/preview-file', methods=['POST'])
def preview_file():
    """Đọc xem trước 5 dòng đầu tiên phục vụ mapping schema giao diện."""
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'Vui lòng chọn file dữ liệu'}), 400

    if not is_allowed_file(file.filename):
        return jsonify({'error': 'Định dạng file không hợp lệ. Chỉ chấp nhận CSV hoặc Excel'}), 400

    try:
        df_preview = load_dataframe(file, nrows=5)
        preview_clean = df_preview.fillna('').to_dict(orient='records')

        return jsonify({
            'success': True,
            'columns': list(df_preview.columns),
            'preview_data': preview_clean
        })
    except Exception as e:
        logger.error(f"Lỗi preview file: {str(e)}")
        return jsonify({'error': f'Lỗi đọc cấu trúc file: {str(e)}'}), 500


@app.route('/api/run-clustering', methods=['POST'])
def run_clustering():
    """
    Tiếp nhận dữ liệu, trích xuất đặc trưng cấp tỉnh và thực thi thuật toán phân cụm.
    Trả về:
    - Danh sách kết quả 34 tỉnh kèm cụm
    - Độ đo đánh giá mô hình (Silhouette, Davies-Bouldin, Elbow WCSS, Linkage matrix)
    - Báo cáo số lượng bản ghi làm sạch (Data Cleansing Metrics)
    """
    start_time = time.time()
    file = request.files.get('file')
    col_province = request.form.get('col_province', '').strip()
    col_score = request.form.get('col_score', '').strip()
    algo = request.form.get('algorithm', 'kmeans').lower()
    linkage_param = request.form.get('linkage', 'ward').lower()

    if not file or not file.filename:
        return jsonify({'error': 'Thiếu file dữ liệu tải lên'}), 400
    if not col_province or not col_score:
        return jsonify({'error': 'Vui lòng chọn đúng cột Mã tỉnh và Cột điểm thi'}), 400

    try:
        k = int(request.form.get('k', 3))
        if not (2 <= k <= 8):
            return jsonify({'error': 'Số cụm k phải nằm trong khoảng từ 2 đến 8'}), 400
    except ValueError:
        return jsonify({'error': 'Số cụm k phải là số nguyên'}), 400

    if algo not in ['kmeans', 'hierarchical']:
        return jsonify({'error': 'Thuật toán được chọn không hợp lệ'}), 400

    try:
        logger.info(f"Bắt đầu xử lý: Thuật toán={algo}, k={k}, File={file.filename}")

        # 1. Tải chỉ 2 cột cần dùng
        df = load_dataframe(file, target_cols=[col_province, col_score])
        total_raw_rows = len(df)

        if total_raw_rows == 0:
            return jsonify({'error': 'Tệp dữ liệu không có dòng bản ghi nào.'}), 400

        # 2. Làm sạch & Tổng hợp đặc trưng cấp tỉnh qua module ml_engine
        agg_df = processor.clean_and_aggregate(df, col_province, col_score)

        if agg_df.empty:
            return jsonify({
                'error': 'Không có dữ liệu hợp lệ khớp với danh mục tỉnh hoặc điểm thi nằm ngoài thang [0, 10].'
            }), 400

        if len(agg_df) < k:
            return jsonify({
                'error': f'Số tỉnh hợp lệ sau khi làm sạch ({len(agg_df)} tỉnh) ít hơn số cụm yêu cầu (k={k}).'
            }), 400

        # 3. Chạy mô hình phân cụm và tính toán độ đo chẩn đoán
        result_df, metrics = processor.cluster_and_evaluate(
            agg_df, algorithm=algo, k=k, linkage=linkage_param
        )

        processing_duration = round(time.time() - start_time, 2)
        total_valid_candidates = int(result_df['total_candidates'].sum())

        logger.info(f"Hoàn thành phân cụm trong {processing_duration}s cho {len(result_df)} tỉnh.")

        # Chuẩn bị dữ liệu trả về cho frontend
        payload_provinces = result_df.fillna('').to_dict(orient='records')

        return jsonify({
            'success': True,
            'processing_time_seconds': processing_duration,
            'data_summary': {
                'total_raw_rows': total_raw_rows,
                'total_valid_candidates': total_valid_candidates,
                'provinces_counted': len(result_df)
            },
            'province_results': payload_provinces,
            'metrics': metrics
        })

    except ValueError as ve:
        logger.warning(f"Lỗi logic cấu hình: {str(ve)}")
        return jsonify({'error': f'Lỗi cấu hình dữ liệu: {str(ve)}'}), 400
    except Exception as e:
        logger.exception("Lỗi hệ thống khi thực thi phân cụm")
        return jsonify({'error': f'Lỗi tính toán mô hình: {str(e)}'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        'error': 'Kích thước tệp vượt quá giới hạn 100MB cho phép. Vui lòng kiểm tra lại file.'
    }), 413


if __name__ == '__main__':
    # Cấu hình host 0.0.0.0 và port 5001 tránh xung đột dịch vụ AirPlay trên macOS
    app.run(host='0.0.0.0', port=5001, debug=True)