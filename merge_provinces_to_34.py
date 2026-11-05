import os
import re
import unicodedata
import geopandas as gpd
from shapely.validation import make_valid

# 1. DANH MỤC 34 TỈNH/THÀNH PHỐ SAU SÁP NHẬP
PROVINCES_34_META = {
    "01": "Thành phố Hà Nội",
    "04": "Tỉnh Cao Bằng",
    "08": "Tỉnh Tuyên Quang",
    "11": "Tỉnh Điện Biên",
    "12": "Tỉnh Lai Châu",
    "14": "Tỉnh Sơn La",
    "15": "Tỉnh Lào Cai",
    "19": "Tỉnh Thái Nguyên",
    "20": "Tỉnh Lạng Sơn",
    "22": "Tỉnh Quảng Ninh",
    "24": "Tỉnh Bắc Ninh",
    "25": "Tỉnh Phú Thọ",
    "31": "Thành phố Hải Phòng",
    "33": "Tỉnh Hưng Yên",
    "37": "Tỉnh Ninh Bình",
    "38": "Tỉnh Thanh Hóa",
    "40": "Tỉnh Nghệ An",
    "42": "Tỉnh Hà Tĩnh",
    "44": "Tỉnh Quảng Trị",
    "46": "Thành phố Huế",
    "48": "Thành phố Đà Nẵng",
    "51": "Tỉnh Quảng Ngãi",
    "52": "Tỉnh Gia Lai",
    "56": "Tỉnh Khánh Hòa",
    "66": "Tỉnh Đắk Lắk",
    "68": "Tỉnh Lâm Đồng",
    "75": "Tỉnh Đồng Nai",
    "79": "Thành phố Hồ Chí Minh",
    "80": "Tỉnh Tây Ninh",
    "82": "Tỉnh Đồng Tháp",
    "86": "Tỉnh Vĩnh Long",
    "91": "Tỉnh An Giang",
    "92": "Thành phố Cần Thơ",
    "96": "Tỉnh Cà Mau"
}

# 2. BẢNG ÁNH XẠ ĐỊA DANH CHUẨN HÓA -> MÃ TỈNH 34
MERGE_RULES_RAW = {
    # 08: Tuyên Quang + Hà Giang
    "tuyenquang": "08", "hagiang": "08",
    # 15: Lào Cai + Yên Bái
    "laocai": "15", "yenbai": "15",
    # 19: Thái Nguyên + Bắc Kạn
    "thainguyen": "19", "backan": "19", "baccan": "19",
    # 25: Phú Thọ + Vĩnh Phúc + Hoà Bình
    "phutho": "25", "vinhphuc": "25", "hoabinh": "25",
    # 24: Bắc Ninh + Bắc Giang
    "bacninh": "24", "bacgiang": "24",
    # 33: Hưng Yên + Thái Bình
    "hungyen": "33", "thaibinh": "33",
    # 31: Hải Phòng + Hải Dương
    "haiphong": "31", "haiduong": "31",
    # 37: Ninh Bình + Hà Nam + Nam Định
    "ninhbinh": "37", "hanam": "37", "namdinh": "37",
    # 44: Quảng Trị + Quảng Bình
    "quangtri": "44", "quangbinh": "44",
    # 48: Đà Nẵng + Quảng Nam
    "danang": "48", "quangnam": "48",
    # 51: Quảng Ngãi + Kon Tum
    "quangngai": "51", "kontum": "51",
    # 52: Gia Lai + Bình Định
    "gialai": "52", "binhdinh": "52",
    # 56: Khánh Hòa + Ninh Thuận
    "khanhhoa": "56", "ninhthuan": "56",
    # 68: Lâm Đồng + Đắk Nông + Bình Thuận
    "lamdong": "68", "daknong": "68", "dacnong": "68", "binhthuan": "68",
    # 66: Đắk Lắk + Phú Yên
    "daklak": "66", "daclac": "66", "phuyen": "66",
    # 79: TP.HCM + Bà Rịa - Vũng Tàu + Bình Dương + Côn Đảo
    "hochiminh": "79", "tphochiminh": "79", "bariavungtau": "79", "binhduong": "79", "condao": "79",
    # 75: Đồng Nai + Bình Phước
    "dongnai": "75", "binhphuoc": "75",
    # 80: Tây Ninh + Long An
    "tayninh": "80", "longan": "80",
    # 92: Cần Thơ + Sóc Trăng + Hậu Giang
    "cantho": "92", "soctrang": "92", "haugiang": "92",
    # 86: Vĩnh Long + Bến Tre + Trà Vinh
    "vinhlong": "86", "bentre": "86", "travinh": "86",
    # 82: Đồng Tháp + Tiền Giang
    "dongthap": "82", "tiengiang": "82",
    # 96: Cà Mau + Bạc Liêu
    "camau": "96", "baclieu": "96",
    # 91: An Giang + Kiên Giang
    "angiang": "91", "kiengiang": "91",

    # Các tỉnh giữ nguyên
    "hanoi": "01",
    "caobang": "04",
    "dienbien": "11",
    "laichau": "12",
    "sonla": "14",
    "langson": "20",
    "quangninh": "22",
    "thanhhoa": "38",
    "nghean": "40",
    "hatinh": "42",
    "thuathienhue": "46",
    "hue": "46"
}


def normalize_key(s: str) -> str:
    """Loại bỏ dấu tiếng Việt và chỉ xóa tiền tố/hậu tố hành chính ở đầu/cuối chuỗi."""
    if not isinstance(s, str):
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    no_accent = "".join([c for c in nfkd if not unicodedata.combining(c)]).replace("đ", "d").replace("Đ", "D").lower().strip()

    # Chỉ loại bỏ tiền tố ở ĐẦU chuỗi (tránh xóa nhầm chữ 'tinh' trong 'ha tinh')
    no_accent = re.sub(r"^(tinh|thanh pho|tp|city|province)\s+", "", no_accent)
    # Loại bỏ hậu tố ở CUỐI chuỗi
    no_accent = re.sub(r"\s+(city|province)$", "", no_accent)

    return re.sub(r"[^a-z0-9]", "", no_accent)


def build_34_provinces():
    input_file = "vietnam_63_provinces.geojson"
    output_dir = os.path.join("static", "data")
    output_file = os.path.join(output_dir, "vietnam_provinces.geojson")
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(input_file) or os.path.getsize(input_file) < 10000:
        print("Lỗi: File vietnam_63_provinces.geojson không tồn tại hoặc bị hỏng dung lượng.")
        return

    print("Đang nạp file ranh giới 63 tỉnh...")
    gdf = gpd.read_file(input_file)

    name_col = next((c for c in ["shapeName", "name", "NAME_1", "ten_tinh"] if c in gdf.columns), None)
    if not name_col:
        name_col = next((c for c in gdf.columns if gdf[c].dtype == "object"), None)

    print(f"-> Cột nhận diện địa danh: '{name_col}'")

    # Ánh xạ tên tỉnh sang mã tỉnh 34
    gdf["clean_key"] = gdf[name_col].apply(normalize_key)
    gdf["new_code"] = gdf["clean_key"].map(MERGE_RULES_RAW)

    unmatched = gdf[gdf["new_code"].isna()]
    if not unmatched.empty:
        print("Cảnh báo: Các địa danh chưa khớp mã:")
        for raw_val, k_val in zip(unmatched[name_col], unmatched["clean_key"]):
            print(f"  - Gốc: '{raw_val}' -> Chuẩn hóa: '{k_val}'")
        gdf = gdf.dropna(subset=["new_code"]).copy()

    print("Đang kiểm tra và sửa lỗi Topology (Self-intersection)...")
    gdf["geometry"] = gdf["geometry"].apply(lambda g: make_valid(g) if g and not g.is_valid else g)

    print("Đang gộp (Dissolve) các mảnh ranh giới thành 34 tỉnh...")
    merged_gdf = gdf.dissolve(by="new_code", as_index=False)

    merged_gdf["id"] = merged_gdf["new_code"].astype(str).str.zfill(2)
    merged_gdf["ma_tinh"] = merged_gdf["id"]
    merged_gdf["name"] = merged_gdf["id"].map(PROVINCES_34_META)
    merged_gdf = merged_gdf[["id", "ma_tinh", "name", "geometry"]]

    print("Đang đơn giản hóa biên giới đa giác (Simplify)...")
    merged_gdf["geometry"] = merged_gdf["geometry"].simplify(tolerance=0.005, preserve_topology=True)

    merged_gdf.to_file(output_file, driver="GeoJSON")

    print("-" * 50)
    print(f"XUẤT THÀNH CÔNG: {output_file}")
    print(f"- Số tỉnh thành gộp được: {len(merged_gdf)} / 34")
    print(f"- Kích thước file: {os.path.getsize(output_file) / 1024:.1f} KB")
    print("-" * 50)


if __name__ == "__main__":
    build_34_provinces()