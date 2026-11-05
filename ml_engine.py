from typing import Any, Dict, Tuple
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import linkage
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.preprocessing import StandardScaler


class ExamDataProcessor:

  def __init__(self, valid_provinces_dict: Dict[str, str]):
    self.valid_provinces = valid_provinces_dict
    self.feature_cols = [
        'mean',
        'median',
        'std',
        'rate_liet',
        'rate_under_5',
        'rate_gte_8',
    ]

  def clean_and_aggregate(
      self, df: pd.DataFrame, col_province: str, col_score: str
  ) -> pd.DataFrame:
    """Lọc dữ liệu rác, kiểm tra điểm [0, 10] và tổng hợp đặc trưng cấp tỉnh hoàn toàn bằng Vectorization."""
    # 1. Trích xuất và loại bỏ NA cơ bản
    sub_df = df[[col_province, col_score]].dropna().copy()

    # 2. Xử lý mã tỉnh an toàn: Tránh lỗi Excel tự convert số thành float (1.0 -> '1.0' -> lệch zfill)
    prov_numeric = pd.to_numeric(sub_df[col_province], errors='coerce')
    sub_df = sub_df[prov_numeric.notna()].copy()
    sub_df['prov_id'] = prov_numeric.astype(int).apply(lambda x: f'{x:02d}')

    # 3. Chuẩn hóa và lọc điểm hợp lệ [0.0, 10.0]
    sub_df['score'] = pd.to_numeric(sub_df[col_score], errors='coerce')
    sub_df = sub_df.dropna(subset=['score'])
    sub_df = sub_df[(sub_df['score'] >= 0.0) & (sub_df['score'] <= 10.0)]

    # 4. Giữ lại các tỉnh nằm trong danh mục 34 tỉnh hợp lệ
    sub_df = sub_df[sub_df['prov_id'].isin(self.valid_provinces.keys())]
    if sub_df.empty:
      return pd.DataFrame()

    # 5. Tạo các cột cờ boolean để tính tỷ lệ % vector hóa cực nhanh
    sub_df['is_liet'] = (sub_df['score'] <= 1.0).astype(float)
    sub_df['is_under_5'] = (sub_df['score'] < 5.0).astype(float)
    sub_df['is_gte_8'] = (sub_df['score'] >= 8.0).astype(float)

    # 6. Gom nhóm và tính toán thống kê mô tả (Chạy Cython native cực nhanh)
    basic_stats = sub_df.groupby('prov_id').agg(
        total_candidates=('score', 'count'),
        mean=('score', 'mean'),
        median=('score', 'median'),
        std=('score', 'std'),
        rate_liet=('is_liet', 'mean'),
        rate_under_5=('is_under_5', 'mean'),
        rate_gte_8=('is_gte_8', 'mean'),
    )
    basic_stats['std'] = basic_stats['std'].fillna(0.0)

    # 7. Tính phân vị Q1 (25%) và Q3 (75%) theo cụm tỉnh
    quantiles = (
        sub_df.groupby('prov_id')['score'].quantile([0.25, 0.75]).unstack()
    )
    quantiles.columns = ['q1', 'q3']

    # 8. Kết hợp kết quả, làm tròn số và gán tên tỉnh
    result_df = basic_stats.join(quantiles).reset_index()

    result_df['rate_liet'] = (result_df['rate_liet'] * 100).round(2)
    result_df['rate_under_5'] = (result_df['rate_under_5'] * 100).round(2)
    result_df['rate_gte_8'] = (result_df['rate_gte_8'] * 100).round(2)
    result_df['mean'] = result_df['mean'].round(2)
    result_df['median'] = result_df['median'].round(2)
    result_df['std'] = result_df['std'].round(2)
    result_df['q1'] = result_df['q1'].round(2)
    result_df['q3'] = result_df['q3'].round(2)
    result_df['total_candidates'] = result_df['total_candidates'].astype(int)

    result_df['province_name'] = result_df['prov_id'].map(
        lambda pid: self.valid_provinces.get(pid, f'Tỉnh {pid}')
    )
    result_df.rename(columns={'prov_id': 'province_id'}, inplace=True)

    return result_df

  def cluster_and_evaluate(
      self,
      agg_df: pd.DataFrame,
      algorithm: str = 'kmeans',
      k: int = 3,
      **kwargs,
  ) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Chuẩn hóa Z-score, phân cụm, chuẩn hóa thứ tự nhãn cụm và chẩn đoán mô hình."""
    df_result = agg_df.copy()
    X = df_result[self.feature_cols].values

    # Chuẩn hóa Z-score
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    linkage_matrix = None
    if algorithm == 'kmeans':
      model = KMeans(
          n_clusters=k,
          random_state=kwargs.get('random_state', 42),
          n_init='auto',
      )
      raw_labels = model.fit_predict(X_scaled)
    elif algorithm == 'hierarchical':
      linkage_type = kwargs.get('linkage', 'ward')
      model = AgglomerativeClustering(n_clusters=k, linkage=linkage_type)
      raw_labels = model.fit_predict(X_scaled)
      # Tính ma trận liên kết hỗ trợ vẽ Dendrogram
      linkage_matrix = linkage(X_scaled, method=linkage_type).tolist()
    else:
      raise ValueError(f"Thuật toán không hỗ trợ: '{algorithm}'")

    # Chuẩn hóa thứ tự cụm: Cụm 0 luôn là cụm có mean thấp nhất -> Cụm k-1 là cụm có mean cao nhất
    cluster_mean_scores = [
        df_result.loc[raw_labels == c, 'mean'].mean() for c in range(k)
    ]
    sorted_cluster_mapping = {
        old_idx: new_idx
        for new_idx, old_idx in enumerate(np.argsort(cluster_mean_scores))
    }
    df_result['cluster'] = np.array(
        [sorted_cluster_mapping[lbl] for lbl in raw_labels]
    )

    # Đánh giá chất lượng phân cụm hiện tại
    sil_score = (
        round(float(silhouette_score(X_scaled, df_result['cluster'])), 3)
        if 1 < k < len(df_result)
        else 0.0
    )
    db_index = (
        round(float(davies_bouldin_score(X_scaled, df_result['cluster'])), 3)
        if 1 < k < len(df_result)
        else 0.0
    )

    # Chẩn đoán Elbow (WCSS) & Silhouette qua các k từ 2 đến min(8, N-1)
    diagnostics = {'elbow_k': [], 'wcss': [], 'silhouette': []}
    max_k = min(9, len(df_result))
    for test_k in range(2, max_k):
      km = KMeans(n_clusters=test_k, random_state=42, n_init='auto').fit(
          X_scaled
      )
      diagnostics['elbow_k'].append(test_k)
      diagnostics['wcss'].append(round(float(km.inertia_), 2))
      diagnostics['silhouette'].append(
          round(float(silhouette_score(X_scaled, km.labels_)), 3)
      )

    metrics = {
        'silhouette_score': sil_score,
        'davies_bouldin_index': db_index,
        'diagnostics': diagnostics,
        'features_used': self.feature_cols,
        'linkage_matrix': linkage_matrix,
    }

    return df_result, metrics