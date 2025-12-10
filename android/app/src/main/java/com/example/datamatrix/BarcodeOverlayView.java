package com.example.datamatrix;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

import androidx.annotation.Nullable;

import com.google.mlkit.vision.barcode.common.Barcode;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;

/**
 * Kamera önizlemesinin üstüne barkodların etrafına kutu çizen overlay.
 * - Okunmuş (scannedCodes içinde olan) barkodlar: YEŞİL çerçeve + ✓ işareti
 * - Algılanmış ama okunmamış (rawValue boş/null): KIRMIZI çerçeve
 * - Algılanmış ama henüz "okundu" set'inde olmayan: SARI çerçeve
 *
 * Ek olarak:
 * - codeStatusMap ile satılabilirlik durumu alınırsa:
 *   status =  1 → SELLABLE  → yeşil
 *   status = -1 → INVALID   → kırmızı
 *   status =  0 → UNKNOWN   → sarı
 */
public class BarcodeOverlayView extends View {

    private final Paint paintScanned = new Paint();   // yeşil çerçeve
    private final Paint paintDetected = new Paint();  // sarı çerçeve
    private final Paint paintError = new Paint();     // kırmızı çerçeve
    private final Paint paintCheck = new Paint();     // ✓ işareti

    private final List<Barcode> barcodes = new ArrayList<>();
    private final Set<String> scannedCodes = new HashSet<>();
    private Map<String, Integer> codeStatusMap = new HashMap<>();

    private int imageWidth = 0;
    private int imageHeight = 0;
    private int rotationDegrees = 0;

    public BarcodeOverlayView(Context context) {
        super(context);
        init();
    }

    public BarcodeOverlayView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    public BarcodeOverlayView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init();
    }

    private void init() {
        paintScanned.setStyle(Paint.Style.STROKE);
        paintScanned.setStrokeWidth(6f);
        paintScanned.setColor(Color.GREEN);
        paintScanned.setAntiAlias(true);

        paintDetected.setStyle(Paint.Style.STROKE);
        paintDetected.setStrokeWidth(4f);
        paintDetected.setColor(Color.YELLOW);
        paintDetected.setAntiAlias(true);

        paintError.setStyle(Paint.Style.STROKE);
        paintError.setStrokeWidth(6f);
        paintError.setColor(Color.RED);
        paintError.setAntiAlias(true);

        paintCheck.setStyle(Paint.Style.FILL);
        paintCheck.setColor(Color.GREEN);
        paintCheck.setAntiAlias(true);
        paintCheck.setTextAlign(Paint.Align.CENTER);
        paintCheck.setTextSize(42f); // gerekirse büyütüp/küçültebiliriz
    }

    /**
     * Eski imza: Analyzer'dan çağrılır: o anda görünen barkodlar + hangi kodların "okunmuş" olduğu bilgisi.
     * Bu sürüm status bilgisi vermez; codeStatusMap boş kalır (yalnız scanned/algılanmış rengine göre boyar).
     */
    public void setData(List<Barcode> newBarcodes,
                        Set<String> scannedCodesSet,
                        int imgWidth,
                        int imgHeight,
                        int rotation) {

        // Eski çağrılar bozulmasın diye, statusMap'i null geçiriyoruz.
        setData(newBarcodes, scannedCodesSet, imgWidth, imgHeight, rotation, null);
    }

    /**
     * Yeni imza: satılabilirlik/statü bilgisi de alır.
     * statusMap:
     *   key   : code (rawValue)
     *   value : 1 → SELLABLE, -1 → INVALID, 0 → UNKNOWN
     */
    public void setData(List<Barcode> newBarcodes,
                        Set<String> scannedCodesSet,
                        int imgWidth,
                        int imgHeight,
                        int rotation,
                        @Nullable Map<String, Integer> statusMap) {

        barcodes.clear();
        if (newBarcodes != null) {
            barcodes.addAll(newBarcodes);
        }

        scannedCodes.clear();
        if (scannedCodesSet != null) {
            scannedCodes.addAll(scannedCodesSet);
        }

        if (statusMap != null) {
            this.codeStatusMap = statusMap;
        } else {
            this.codeStatusMap = new HashMap<>();
        }

        imageWidth = imgWidth;
        imageHeight = imgHeight;
        rotationDegrees = rotation;

        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        if (barcodes.isEmpty() || imageWidth == 0 || imageHeight == 0) {
            return;
        }

        int viewWidth = getWidth();
        int viewHeight = getHeight();

        float scaleX;
        float scaleY;

        // Basit ölçekleme: portre modda genelde rotation 90/270 geliyor
        if (rotationDegrees == 90 || rotationDegrees == 270) {
            // Genişlik/yükseklik takla atıyor
            scaleX = viewWidth * 1f / imageHeight;
            scaleY = viewHeight * 1f / imageWidth;
        } else {
            scaleX = viewWidth * 1f / imageWidth;
            scaleY = viewHeight * 1f / imageHeight;
        }

        for (Barcode barcode : barcodes) {
            Rect box = barcode.getBoundingBox();
            if (box == null) continue;

            float left = box.left * scaleX;
            float top = box.top * scaleY;
            float right = box.right * scaleX;
            float bottom = box.bottom * scaleY;

            String value = barcode.getRawValue();
            Paint borderPaint;

            if (value == null || value.isEmpty()) {
                // Algılanmış ama decode edilememiş (oldukça nadir durum)
                borderPaint = paintError; // kırmızı çerçeve
            } else {
                // Önce statü haritasına bak
                Integer status = (codeStatusMap != null) ? codeStatusMap.get(value) : null;

                if (status != null) {
                    if (status == 1) {
                        // Satılabilir / geçerli
                        borderPaint = paintScanned;   // yeşil
                    } else if (status == -1) {
                        // Geçersiz / satılamaz
                        borderPaint = paintError;     // kırmızı
                    } else {
                        // UNKNOWN / henüz sorgulanmamış
                        borderPaint = paintDetected;  // sarı
                    }
                } else if (scannedCodes.contains(value)) {
                    // Statü yoksa, eski davranış: okunanlar → yeşil
                    borderPaint = paintScanned;
                } else {
                    // Algılanmış ama henüz "okundu" sayılmamış
                    borderPaint = paintDetected;
                }
            }

            RectF rectF = new RectF(left, top, right, bottom);
            canvas.drawRoundRect(rectF, 16f, 16f, borderPaint);

            // Üzerine ✓ işareti koy (sadece okunanlar için)
            if (value != null && scannedCodes.contains(value)) {
                float cx = (left + right) / 2f;
                float cy = (top + bottom) / 2f;
                // ✓ biraz aşağı kaymasın diye küçük bir offset
                float textOffset = (paintCheck.descent() + paintCheck.ascent()) / 2f;
                canvas.drawText("✓", cx, cy - textOffset, paintCheck);
            }
        }
    }
}
