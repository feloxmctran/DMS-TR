package com.example.datamatrix;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.Image;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Size;
import android.text.InputType;
import android.widget.EditText;
import android.view.inputmethod.EditorInfo;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.MeteringPointFactory;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import tr.com.dmstr.app.R;


@ExperimentalGetImage   // getImage() için
public class FastMultiScanActivity extends AppCompatActivity {

    private static final int REQUEST_CODE_PERMISSIONS = 42;
    private static final String[] REQUIRED_PERMISSIONS = new String[]{ Manifest.permission.CAMERA };

    // NDB anonim QR endpoint (App.tsx → TEST_ENDPOINTS.apiUrl ile aynı)
    private static final String FAST_API_BASE_URL =
            "https://testndbapi.med.kg";
    private static final String FAST_PRODUCT_INQUIRY_PATH =
            "/api/TrackAndTrace/ProductInquiryQRCode";

    private PreviewView previewView;
    private TextView tvCount;
    private TextView tvDistanceHint;
    private BarcodeOverlayView overlayView;
    private Button btnSave;
    private ImageButton btnClose;

    private ExecutorService cameraExecutor;
    private BarcodeScanner barcodeScanner;

    // Kamera referansı (autofocus için)
    private Camera camera;

    // Tek seferde toplanan barkodları tutacağız (tekrarları filtrelemek için Set)
    private final Set<String> scannedCodes = new HashSet<>();

    // Mesafe uyarısı için state
    private String currentDistanceHint = null;
    private Runnable hideDistanceHintRunnable = null;

    // Aynı oturumu iki kere kaydetmesin diye
    private boolean hasSaved = false;

    // Easy ekrani icin: not sorma bayragi
    private boolean skipNote = false;

    // ====== KOD DOĞRULAMA DURUMLARI (ASYNC) ======

    private enum CodeStatus {
        UNKNOWN,
        SELLABLE,
        INVALID
    }

    // Kod -> durum haritası
    private final Map<String, CodeStatus> codeStatusMap = new ConcurrentHashMap<>();
    // Doğrulama kuyruğu
    private final BlockingQueue<String> validationQueue = new LinkedBlockingQueue<>();
    // Arka plan doğrulama thread'i
    private ExecutorService validationExecutor;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_fast_multi_scan);
        skipNote = getIntent().getBooleanExtra("skipNote", false);

        previewView = findViewById(R.id.previewView);
        tvCount = findViewById(R.id.tvCount);
        tvDistanceHint = findViewById(R.id.tvDistanceHint);
        overlayView = findViewById(R.id.overlayView);
        btnSave = findViewById(R.id.btnSave);
        btnClose = findViewById(R.id.btnClose);

        cameraExecutor = Executors.newSingleThreadExecutor();

        // Sadece DataMatrix + QR okutalım
        BarcodeScannerOptions options =
                new BarcodeScannerOptions.Builder()
                        .setBarcodeFormats(
                                Barcode.FORMAT_DATA_MATRIX,
                                Barcode.FORMAT_QR_CODE
                        )
                        .build();

        barcodeScanner = BarcodeScanning.getClient(options);

        // Kod doğrulama için arka plan thread'i başlat
        validationExecutor = Executors.newSingleThreadExecutor();
        validationExecutor.submit(this::validationLoop);

        // X: sadece sonucu JS tarafına gönderir, KAYDETMEZ
        btnClose.setOnClickListener(v -> {
            List<String> list = new ArrayList<>(scannedCodes);

            // List<String> → JSONArray çevir
            JSONArray arr = new JSONArray();
            for (String c : list) {
                if (c != null && !c.isEmpty()) {
                    arr.put(c);
                }
            }

            FastStockScannerPlugin.finishMultiScan(arr);
            finish();
        });

        // Kaydet: önce not sor, sonra SQLite'a yaz + JS'e sonucu gönder + kamerayı kapat
        btnSave.setOnClickListener(v -> showSaveNoteDialog());

        if (allPermissionsGranted()) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this, REQUIRED_PERMISSIONS, REQUEST_CODE_PERMISSIONS);
        }
    }

    private boolean allPermissionsGranted() {
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture =
                ProcessCameraProvider.getInstance(this);

        cameraProviderFuture.addListener(() -> {
            try {
                ProcessCameraProvider cameraProvider = cameraProviderFuture.get();

                // Önceki binding'leri temizle
                cameraProvider.unbindAll();

                // Daha yüksek çözünürlükte önizleme
                Preview preview = new Preview.Builder()
                        .setTargetResolution(new Size(1280, 720))
                        .build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

                // Daha yüksek çözünürlükte ImageAnalysis
                ImageAnalysis imageAnalysis = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();

                imageAnalysis.setAnalyzer(cameraExecutor, this::analyzeImage);

                // Kamerayı lifecycle'a bağla ve referansını sakla
                camera = cameraProvider.bindToLifecycle(
                        this,
                        cameraSelector,
                        preview,
                        imageAnalysis
                );

                // Kamera açılır açılmaz merkezde agresif bir autofocus denemesi yap
                triggerCenterAutoFocus();

            } catch (ExecutionException | InterruptedException e) {
                e.printStackTrace();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    /**
     * Kamera açıldığında merkez noktaya odaklanmak için kullanılır.
     */
    private void triggerCenterAutoFocus() {
        if (camera == null || previewView == null) return;

        // PreviewView boyutları henüz 0 ise, layout tamamlanınca çağır
        if (previewView.getWidth() == 0 || previewView.getHeight() == 0) {
            previewView.post(this::triggerCenterAutoFocus);
            return;
        }

        MeteringPointFactory factory = previewView.getMeteringPointFactory();
        MeteringPoint centerPoint = factory.createPoint(
                previewView.getWidth() / 2f,
                previewView.getHeight() / 2f
        );

        FocusMeteringAction action = new FocusMeteringAction.Builder(centerPoint, FocusMeteringAction.FLAG_AF)
                .setAutoCancelDuration(3, TimeUnit.SECONDS)
                .build();

        camera.getCameraControl().startFocusAndMetering(action);
    }

    @ExperimentalGetImage
    private void analyzeImage(@NonNull ImageProxy imageProxy) {
        Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            imageProxy.close();
            return;
        }

        int rotationDegrees = imageProxy.getImageInfo().getRotationDegrees();
        InputImage image = InputImage.fromMediaImage(mediaImage, rotationDegrees);

        barcodeScanner.process(image)
                .addOnSuccessListener(barcodes -> {
                    boolean changed = false;

                    // Barkodları işle, yeni gördüklerini sete ekle
                    for (Barcode barcode : barcodes) {
                        String rawValue = barcode.getRawValue();
                        if (rawValue != null && !rawValue.isEmpty()) {
                            // İlk kez görüyorsak sete ekle
                            if (scannedCodes.add(rawValue)) {
                                changed = true;

                                // API doğrulaması yok: "okundu ve listeye eklendi" demek için direkt yeşil işaretle
                                codeStatusMap.put(rawValue, CodeStatus.SELLABLE);

                                // doğrulama kuyruğuna göndermiyoruz
                                // enqueueForValidation(rawValue);
                            }

                        }
                    }

                    // Mesafe (yakın/uzak) tahmini için ortalama alan oranını hesapla
                    String distanceHintText = null;
                    if (!barcodes.isEmpty()) {
                        double sumRatio = 0.0;
                        int boxCount = 0;
                        double frameArea = mediaImage.getWidth() * 1.0 * mediaImage.getHeight();

                        for (Barcode barcode : barcodes) {
                            if (barcode.getBoundingBox() == null) continue;
                            int w = barcode.getBoundingBox().width();
                            int h = barcode.getBoundingBox().height();
                            double area = w * 1.0 * h;
                            double ratio = area / frameArea;
                            sumRatio += ratio;
                            boxCount++;
                        }

                        if (boxCount > 0) {
                            double avgRatio = sumRatio / boxCount;
                            if (avgRatio > 0.35) {
                                distanceHintText = "Kamerayı biraz uzaklaştırın.";
                            } else if (avgRatio < 0.01) {
                                distanceHintText = "Kamerayı biraz yaklaştırın.";
                            } else {
                                distanceHintText = null;
                            }
                        }
                    }

                    // Overlay'i güncelle (hangi barkod nerede, hangisi okundu? + status map)
                    if (overlayView != null) {
                        runOnUiThread(() -> {
                            // CodeStatus -> int map (1: SELLABLE, -1: INVALID, 0: UNKNOWN)
                            Map<String, Integer> statusMap = new HashMap<>();
                            for (Map.Entry<String, CodeStatus> e : codeStatusMap.entrySet()) {
                                int v;
                                if (e.getValue() == CodeStatus.SELLABLE) {
                                    v = 1;
                                } else if (e.getValue() == CodeStatus.INVALID) {
                                    v = -1;
                                } else {
                                    v = 0;
                                }
                                statusMap.put(e.getKey(), v);
                            }

                            overlayView.setData(
                                    barcodes,
                                    scannedCodes,
                                    mediaImage.getWidth(),
                                    mediaImage.getHeight(),
                                    rotationDegrees,
                                    statusMap
                            );
                        });
                    }

                    // Sayaç ve animasyon
                    if (changed && tvCount != null) {
                        runOnUiThread(() -> {
                            tvCount.setText(String.valueOf(scannedCodes.size()));

                            tvCount.animate().cancel();
                            tvCount.setScaleX(1f);
                            tvCount.setScaleY(1f);
                            tvCount.animate()
                                    .scaleX(1.2f)
                                    .scaleY(1.2f)
                                    .setDuration(100)
                                    .withEndAction(() ->
                                            tvCount.animate()
                                                    .scaleX(1f)
                                                    .scaleY(1f)
                                                    .setDuration(100)
                                    )
                                    .start();
                        });
                    }

                    // Mesafe uyarısını güncelle
                    updateDistanceHint(distanceHintText);

                })
                .addOnFailureListener(Throwable::printStackTrace)
                .addOnCompleteListener(task -> imageProxy.close());
    }

    /**
     * "Kaydet" butonu için asıl iş:
     * - Mevcut scannedCodes listesini alır
     * - Cihazın device_id'si ile birlikte SQLite'a yazar (opsiyonel not ile)
     * - JS tarafına sonucu gönderir
     * - Kamerayı kapatır (finish)
     */
    private void onSaveClicked(String noteText) {
        if (hasSaved) {
            Toast.makeText(this, "Bu oturum zaten kaydedildi.", Toast.LENGTH_SHORT).show();
            return;
        }

        List<String> codes = new ArrayList<>(scannedCodes);
        if (codes.isEmpty()) {
            Toast.makeText(this, "Kaydedilecek barkod yok.", Toast.LENGTH_SHORT).show();
            return;
        }

        // Cihaz kimliği (telefon bazlı)
        String deviceId = Settings.Secure.getString(
                getContentResolver(),
                Settings.Secure.ANDROID_ID
        );

        // Tarih-saat
        String createdAt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss",
                java.util.Locale.getDefault()
        ).format(new java.util.Date());

        // Boş string yerine null gönderelim
        String note = (noteText != null && !noteText.trim().isEmpty())
                ? noteText.trim()
                : null;

        ScanDatabaseHelper db = ScanDatabaseHelper.getInstance(this);
        long sessionId = db.insertSession(createdAt, note, codes.size(), deviceId);
        if (sessionId > 0) {
            db.insertItems(sessionId, codes, createdAt);
            hasSaved = true;

            Toast.makeText(this,
                    "Sayım kaydedildi. Oturum ID: " + sessionId,
                    Toast.LENGTH_SHORT).show();

            // ✔ Kaydetten sonra JS tarafına sonucu gönder ve ekranı kapat
            // List<String> → JSONArray çevir
            JSONArray arr = new JSONArray();
            for (String c : codes) {
                if (c != null && !c.isEmpty()) {
                    arr.put(c);
                }
            }

            FastStockScannerPlugin.finishMultiScan(arr);
            finish();
        } else {
            Toast.makeText(this,
                    "Sayım kaydedilirken bir hata oluştu.",
                    Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Kaydet'e basıldığında not soran dialog.
     * Not zorunlu değil; boş bırakılırsa not olmadan kaydeder.
     */
    private void showSaveNoteDialog() {
        if (hasSaved) {
            Toast.makeText(this, "Bu oturum zaten kaydedildi.", Toast.LENGTH_SHORT).show();
            return;
        }

        // Easy ekrani icin: not sormadan direkt kaydet
        if (skipNote) {
            onSaveClicked("");
            return;
        }

        final EditText input = new EditText(this);
        input.setHint("Örneğin: Reçete raf sayımı");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);

        new AlertDialog.Builder(this)
                .setTitle("Not eklemek ister misiniz?")
                .setView(input)
                .setNegativeButton("Vazgeç", (dialog, which) -> {
                    dialog.dismiss();
                })
                .setPositiveButton("Tamam", (dialog, which) -> {
                    String noteText = input.getText().toString();
                    onSaveClicked(noteText);
                })
                .show();
    }

    /**
     * Mesafe uyarısını ekranda en az 1 saniye gösterip, sonra otomatik gizler.
     */
    private void updateDistanceHint(String newHint) {
        if (tvDistanceHint == null) return;

        runOnUiThread(() -> {
            // Yeni anlamlı bir uyarı geldiyse hemen göster
            if (newHint != null && !newHint.isEmpty()) {
                currentDistanceHint = newHint;
                tvDistanceHint.setText(newHint);
                tvDistanceHint.setVisibility(View.VISIBLE);

                // Eski gizleme görevini iptal et
                if (hideDistanceHintRunnable != null) {
                    tvDistanceHint.removeCallbacks(hideDistanceHintRunnable);
                }

                // 1 saniye sonra, hâlâ aynı uyarı geçerliyse gizle
                hideDistanceHintRunnable = () -> {
                    if (currentDistanceHint != null && currentDistanceHint.equals(newHint)) {
                        tvDistanceHint.setVisibility(View.GONE);
                        currentDistanceHint = null;
                    }
                };
                tvDistanceHint.postDelayed(hideDistanceHintRunnable, 1000);
            }
            // newHint == null ise burada hemen gizlemiyoruz; mevcut uyarı süresi dolunca kaybolacak
        });
    }

    // ====== DOĞRULAMA KUYRUĞU & API BAĞLANTISI ALTYAPISI ======

    /**
     * Yeni bir kodu doğrulama kuyruğuna ekler.
     * Daha önce hiç görmediysek UNKNOWN olarak işaretler.
     */
    private void enqueueForValidation(String code) {
        if (!codeStatusMap.containsKey(code)) {
            codeStatusMap.put(code, CodeStatus.UNKNOWN);
            validationQueue.offer(code);
        }
    }

    /**
     * Kuyruktan kod alıp API ile doğrulayan döngü.
     * Bu metod arka planda tek thread'de çalışır.
     */
    private void validationLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                String code = validationQueue.poll(500, TimeUnit.MILLISECONDS);
                if (code == null) {
                    continue;
                }

                boolean sellable = isSellableFromApi(code);

                codeStatusMap.put(code, sellable ? CodeStatus.SELLABLE : CodeStatus.INVALID);

                // Overlay'i yeniden çiz (renkler güncellensin)
                runOnUiThread(() -> {
                    if (overlayView != null) {
                        overlayView.invalidate();
                    }
                });

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                // herhangi bir hata → bu kodu satılamaz say (zaten isSellableFromApi false dönecek)
            }
        }
    }

    /**
     * Datamatrix'i doğrudan NDB anonim QR endpoint'ine sorar.
     *
     * - URL: https://testndbapi.med.kg/api/TrackAndTrace/ProductInquiryQRCode
     * - Body: { "qrCode": "<datamatrix>" }
     * - Response: InquiryResponse (App.tsx'tekiyle aynı)
     *
     * Dönen JSON'da:
     *   actionResult yoksa      → satılamaz (false)
     *   isSuspendedOrRecalled   → true ise satılamaz
     *   isExpired               → true ise satılamaz
     *   isAvailableForSale      → true VE üsttekiler false ise satılabilir
     */
    private boolean isSellableFromApi(String code) {
        HttpURLConnection conn = null;
        try {
            String urlStr = FAST_API_BASE_URL + FAST_PRODUCT_INQUIRY_PATH;
            URL url = new URL(urlStr);

            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000); // 5 sn
            conn.setReadTimeout(7000);    // 7 sn
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Accept", "text/plain");
            conn.setRequestProperty("Content-Type", "application/json-patch+json");

            // Request body: { "qrCode": "<datamatrix>" }
            JSONObject body = new JSONObject();
            body.put("qrCode", code);

            byte[] out = body.toString().getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(out.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }

            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                // Sunucu 200 dönmezse satılamaz say
                return false;
            }

            // Response body'yi oku
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), "UTF-8")
            )) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }

            String responseText = sb.toString();
            if (responseText == null || responseText.isEmpty()) {
                return false;
            }

            JSONObject json = new JSONObject(responseText);

            // actionResult yoksa satılamaz
            JSONObject ar = json.optJSONObject("actionResult");
            if (ar == null) {
                return false;
            }

            // Suspend / recall bayrağı
            boolean suspended = ar.optBoolean(
                    "isSuspendedOrRecalled",
                    ar.optBoolean("IsSuspendedOrRecalled", false)
            );

            // Son kullanma tarihi geçmiş mi?
            boolean isExpired = ar.optBoolean("isExpired", false);

            // Sunucunun "satılabilir" bayrağı
            boolean isAvailableForSale = ar.optBoolean("isAvailableForSale", false);

            // Son karar: hem sunucu satılabilir desin, hem de askıda/geri çağrılmış/expired olmasın
            return isAvailableForSale && !suspended && !isExpired;

        } catch (Exception e) {
            // Herhangi bir hata durumunda satılamaz say
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
        }
        if (barcodeScanner != null) {
            barcodeScanner.close();
        }
        if (tvDistanceHint != null && hideDistanceHintRunnable != null) {
            tvDistanceHint.removeCallbacks(hideDistanceHintRunnable);
        }
        if (validationExecutor != null) {
            validationExecutor.shutdownNow();
            try {
                validationExecutor.awaitTermination(2, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CODE_PERMISSIONS) {
            if (allPermissionsGranted()) {
                startCamera();
            } else {
                // İzin verilmezse boş liste ile döndürüp ekranı kapat
                List<String> list = new ArrayList<>(scannedCodes);
                JSONArray arr = new JSONArray();
                for (String c : list) {
                    if (c != null && !c.isEmpty()) {
                        arr.put(c);
                    }
                }
                FastStockScannerPlugin.finishMultiScan(arr);
                finish();
            }
        }
    }
}
