# Bubblecap

Bubble chart top 100 coin: bubble va chạm và trôi nhẹ, kéo thả được, đổi khung 1h / 24h / 7d,
đổi cách tính cỡ bubble (theo biến động hoặc market cap). Không có backend: GitHub Actions lấy giá
mỗi 10 phút, ghi ra `public/data/coins.json`, build rồi deploy lên GitHub Pages.

## Chạy thử ở máy

```bash
npm install
npm run dev        # mở http://localhost:5173 (đang dùng dữ liệu mẫu)
npm run fetch      # tuỳ chọn: lấy giá thật, ghi đè public/data/coins.json
npm run typecheck  # kiểm tra kiểu TypeScript
```

Nên chạy `npm run fetch` sớm để chắc chắn tên trường của API (CoinLore, dự phòng CoinPaprika)
khớp với `scripts/fetch-data.ts`.

## Deploy bằng GitHub Actions

1. Tạo repo **public** (repo public chạy Actions không giới hạn phút), push code lên nhánh `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Update data and deploy" → Run workflow (các lần sau tự chạy theo cron).
4. Sau khi chạy `npm install` ở máy, commit thêm `package-lock.json`, rồi trong workflow
   đổi `npm install` thành `npm ci` và thêm `cache: npm` cho `setup-node`.

Nếu fetch lỗi ở cả hai nguồn, workflow dừng và bản cũ trên Pages được giữ nguyên.

## Cấu trúc

```
scripts/fetch-data.ts      lấy dữ liệu, chuẩn hoá về một schema chung
src/BubbleChart.tsx        d3-force + Canvas (mô phỏng, vẽ, hover, kéo thả)
src/App.tsx                thanh điều khiển, tải coins.json, làm mới mỗi 5 phút
src/utils.ts               tính bán kính, màu, định dạng số, danh sách stablecoin
public/data/coins.json     dữ liệu mẫu (bị ghi đè khi fetch / khi Action chạy)
```

## Tuỳ chỉnh nhanh

- Danh sách stablecoin bị ẩn: `STABLECOINS` trong `src/utils.ts`
- Độ lấp đầy khung (42%), bán kính nhỏ nhất, số mũ nén kích thước: `computeRadii` trong `src/utils.ts`
- Độ "dính" về tâm và độ nảy: các `force` trong `src/BubbleChart.tsx`
- Màu: biến CSS ở đầu `src/styles.css`

Dữ liệu giá thuộc về nguồn cung cấp (CoinLore / CoinPaprika), hãy đọc điều khoản của họ và ghi nguồn trên giao diện.
