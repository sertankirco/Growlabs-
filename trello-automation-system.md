# Trello Pano Yapısı ve Otomasyon Tasarımı

YouTube içerik üretim sürecini WhatsApp ve Mail ile entegre etmek için optimize edilmiş Trello yapısı.

## 📋 1. Pano Listeleri (Süreç Akışı)

Süreci takip etmek için aşağıdaki listelerin oluşturulması önerilir:

| Liste Adı | Açıklama |
|:----------|:---------|
| **Ham Görüntüler** | Çekimi tamamlanan ve kurguya girmeyi bekleyen videolar. |
| **Kurgu Aşamasında** | Editörün üzerinde çalıştığı aktif projeler. |
| **Müşteri Onayında** | Drive/YouTube linki WhatsApp'tan gönderilmiş, cevap beklenen videolar. |
| **Revize Bekliyor** | WhatsApp'tan revize mesajı gelmiş ve maili gönderilmiş projeler. |
| **Tamamlandı** | Onaylanmış ve yayına hazır videolar. |

## 🎴 2. Kart Yapısı ve Özel Alanlar (Custom Fields)

Her video projesi bir kart olarak temsil edilir. Kartın içinde şu bilgiler bulunmalıdır:

### Kart Başlığı
```
[Müşteri Adı] - [Video Konusu]
```

### Açıklama
Videonun genel detayları, özel notlar ve talimatlar.

### Özel Alanlar (Custom Fields)

| Alan Adı | Tip | Açıklama | Örnek |
|:---------|:----|:---------|:------|
| **Müşteri Telefon** | Text | WhatsApp eşleşmesi için | 905XXXXXXXXX |
| **Editör Mail** | Text | Revize geldiğinde mail gidecek kişinin adresi | editor@growlabs.com |
| **Video Linki** | URL | Drive veya YouTube linki | https://drive.google.com/... |

## 🤖 3. Otomasyon Senaryoları (Make.com / Zapier)

Sistemin kalbi olan otomasyonlar şu şekilde kurgulanmalıdır:

### Senaryo A: WhatsApp'tan Trello'ya (Giriş)

**Amaç:** WhatsApp'tan gelen müşteri mesajlarını otomatik olarak ilgili Trello kartına eklemek ve kartı doğru listeye taşımak.

#### Adımlar:

1. **Tetikleyici (Trigger):** WhatsApp'tan yeni bir mesaj gelir
   - Platform: WhatsApp Business API veya Twilio
   - Olay: Yeni mesaj alındı

2. **Arama (Search):** Mesajı gönderen numara Trello'daki "Müşteri Telefon" alanı ile eşleştirilir
   - Trello API: Custom field'da arama
   - Filtre: Müşteri Telefon = Gönderen Numara

3. **Eylem 1 (Action):** Eşleşen kart "Müşteri Onayında" listesinden "Revize Bekliyor" listesine taşınır
   - Trello API: Update Card
   - Hedef Liste: "Revize Bekliyor"

4. **Eylem 2 (Action):** Gelen mesaj kartın içine "Yorum" olarak eklenir
   - Trello API: Add Comment
   - İçerik: "[WhatsApp] Müşteri Notu: [Mesaj İçeriği] - [Tarih/Saat]"

#### Make.com Modül Yapısı:
```
[WhatsApp: Watch Messages]
    → [Trello: Search Cards by Custom Field]
    → [Router]
        → [Trello: Move Card to List]
        → [Trello: Add Comment to Card]
```

---

### Senaryo B: Trello'dan Mail'e (Çıkış)

**Amaç:** "Revize Bekliyor" listesine taşınan kartlar için editöre otomatik bildirim maili göndermek.

#### Adımlar:

1. **Tetikleyici (Trigger):** Bir kart "Revize Bekliyor" listesine taşındığında
   - Platform: Trello Webhook
   - Olay: Card moved to list

2. **Filtre:** Liste adı = "Revize Bekliyor"
   - Sadece bu listeye taşınan kartlar için devam et

3. **Eylem (Action):** Karttaki "Editör Mail" adresine otomatik bir mail gönderilir
   - Platform: Gmail, Outlook veya SMTP
   - Alıcı: Custom Field "Editör Mail"

#### Mail İçeriği (Template):

```html
Konu: 🎬 Yeni Revize Talebi: [Kart Adı]

Sayın Editör,

[Kart Adı] projesi için yeni bir revize talebi geldi.

📝 Müşteri Notu:
[Son WhatsApp Mesajı]

🔗 Proje Detayları:
- Video Linki: [Video Linki Custom Field]
- Trello Kartı: [Kart URL'si]

Lütfen Trello kartını kontrol edin ve revizeleri en kısa sürede tamamlayın.

İyi çalışmalar,
GrowLabs Otomasyon Sistemi
```

#### Make.com Modül Yapısı:
```
[Trello: Watch Card Moved]
    → [Filter: List Name = "Revize Bekliyor"]
    → [Trello: Get Card Details]
    → [Gmail/SMTP: Send Email]
```

---

## 🔧 4. Trello Butler (Dahili Otomasyon)

Eğer harici bir araç (Make/Zapier) yerine Trello'nun kendi gücünü kullanmak isterseniz:

### Butler Kuralları

#### Kural 1: Editör Bildirimi
```
when a card is added to list "Revize Bekliyor",
send an email to {customfield_editormail} with subject "Yeni Revize: {cardname}" and message "Müşteri notu: {cardlink}"
```

#### Kural 2: Otomatik Etiketleme
```
when a card is moved to list "Müşteri Onayında",
add the yellow label "⏳ Onay Bekliyor" to the card
```

#### Kural 3: Tamamlanma Bildirimi
```
when a card is moved to list "Tamamlandı",
add a comment "@board Proje tamamlandı! ✅"
```

#### Kural 4: Gecikme Uyarısı
```
every monday at 9:00 AM,
for each card in list "Revize Bekliyor",
if the card is older than 3 days,
add a comment "⚠️ Bu revize 3 gündür bekliyor. Lütfen önceliklendiriniz."
```

---

## 📊 5. Veri Akış Diyagramı

```
WhatsApp Mesajı Geldi
        ↓
Müşteri Telefonu ile Trello'da Arama
        ↓
Kart Bulundu mu?
    ├─ EVET → Kartı "Revize Bekliyor"ya Taşı
    │            ↓
    │         WhatsApp Mesajını Yorum Olarak Ekle
    │            ↓
    │         Editöre Mail Gönder
    │            ↓
    │         Süreç Tamamlandı ✅
    │
    └─ HAYIR → Manuel İşlem Gerekli ⚠️
                (Yeni kart oluştur veya müşteriyi bilgilendir)
```

---

## 🚀 6. Kurulum Adımları

### 6.1 Trello Panosu Kurulumu

1. **Yeni Pano Oluştur**
   - Adı: "YouTube İçerik Üretim Süreci"
   - Görünürlük: Workspace visible

2. **Listeleri Oluştur** (Sırasıyla)
   - Ham Görüntüler
   - Kurgu Aşamasında
   - Müşteri Onayında
   - Revize Bekliyor
   - Tamamlandı

3. **Custom Fields Power-Up Aktif Et**
   - Settings → Power-Ups → Custom Fields → Enable

4. **Özel Alanları Oluştur**
   - Müşteri Telefon (Text)
   - Editör Mail (Text)
   - Video Linki (Text/URL)

### 6.2 Make.com Kurulumu

1. **Make.com Hesabı Oluştur**
   - make.com adresinden kayıt ol

2. **Trello Bağlantısı**
   - Apps → Trello → Add Connection
   - Trello hesabını yetkilendir

3. **WhatsApp Bağlantısı**
   - WhatsApp Business API veya Twilio hesabı gerekli
   - Apps → WhatsApp/Twilio → Add Connection

4. **Gmail/SMTP Bağlantısı**
   - Apps → Gmail → Add Connection
   - Google hesabını yetkilendir

5. **Senaryoları Oluştur**
   - "Senaryo A: WhatsApp → Trello" senaryosunu kur
   - "Senaryo B: Trello → Mail" senaryosunu kur
   - Her senaryoyu test et ve aktif hale getir

### 6.3 WhatsApp Business API Kurulumu

1. **Twilio Hesabı** (Önerilen)
   - twilio.com'dan hesap oluştur
   - WhatsApp Sandbox'u aktif et (test için)
   - Üretim için WhatsApp Business API başvurusu yap

2. **Webhook Yapılandırması**
   - Make.com'dan webhook URL'si al
   - Twilio'da bu URL'yi kaydet
   - Mesaj alındığında Make senaryosunu tetikle

---

## 📈 7. Test Senaryoları

### Test 1: WhatsApp Mesajı Alımı
1. Bir test kartı oluştur "Müşteri Onayında" listesinde
2. Müşteri Telefon alanına test numaranızı ekleyin
3. WhatsApp'tan bu numaradan bir mesaj gönderin
4. **Beklenen Sonuç:**
   - Kart "Revize Bekliyor"ya taşınmalı
   - Mesaj yorum olarak eklenmiş olmalı
   - Editöre mail gitmiş olmalı

### Test 2: Mail Bildirimi
1. Bir kartı manuel olarak "Revize Bekliyor"ya taşıyın
2. **Beklenen Sonuç:**
   - Editör Mail alanındaki adrese bildirim gitmeli
   - Mail içeriği doğru template'i takip etmeli

---

## ⚠️ 8. Dikkat Edilmesi Gerekenler

### Güvenlik
- WhatsApp Business API anahtarlarını güvenli saklayın
- Trello API token'ları paylaşmayın
- Make.com senaryolarında hassas verileri log'lamayın

### Veri Kalitesi
- Müşteri telefon numaraları standart formatta olmalı (örn: 905XXXXXXXXX)
- Editör mail adresleri geçerli olmalı
- Boş custom field'ları kontrol edin

### Hata Yönetimi
- Make.com'da error handling ekleyin
- Eşleşmeyen numaralar için fallback akışı oluşturun
- Log mekanizması kurun (örn: Google Sheets'e kaydet)

### Maliyet
- Make.com ücretsiz plan: 1,000 operasyon/ay
- Twilio WhatsApp: Mesaj başına ücretlendirme
- Trello: Custom Fields için Business Class veya üstü gerekebilir

---

## 🔄 9. Gelecek Geliştirmeler

### Önerilen İyileştirmeler

1. **Otomatik Durum Güncellemeleri**
   - Video onaylandığında müşteriye otomatik WhatsApp mesajı
   - Proje tamamlandığında fatura/ödeme linki gönderimi

2. **Raporlama**
   - Haftalık proje durumu raporu (Google Sheets)
   - Editör performans metrikleri (tamamlama süreleri)

3. **AI Entegrasyonu**
   - Müşteri mesajlarını kategorize etmek için NLP
   - Revize taleplerinin aciliyet analizi

4. **Dashboard**
   - Gerçek zamanlı proje durumu görüntüleme
   - Editör iş yükü takibi

---

## 📞 10. Destek ve Yardım

### Kaynaklar
- Trello API Dokümantasyonu: https://developer.atlassian.com/cloud/trello/
- Make.com Dokümantasyonu: https://www.make.com/en/help/
- Twilio WhatsApp API: https://www.twilio.com/docs/whatsapp

### Sorun Giderme
- **Kart bulunamıyor:** Müşteri telefon formatını kontrol edin
- **Mail gitmiyor:** Editör Mail alanının dolu olduğundan emin olun
- **WhatsApp mesajı alınmıyor:** Webhook URL'sini ve Twilio ayarlarını kontrol edin

---

## ✅ Sistem Kullanıma Hazır!

Bu doküman, YouTube içerik üretim sürecinizi tamamen otomatize etmek için gereken tüm bilgileri içermektedir. Kurulum sonrası sistem şu faydaları sağlayacaktır:

- ⚡ Manuel veri girişi ortadan kalkar
- 📧 Editörler anında bilgilendirilir
- 📊 Tüm süreç Trello üzerinde şeffaf takip edilir
- ⏰ Zaman tasarrufu ve hata oranı azalır

**İyi çalışmalar! 🚀**
