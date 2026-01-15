# 🚀 Trello Otomasyon Sistemi - Hızlı Başlangıç Kılavuzu

Bu kılavuz, YouTube içerik üretim sürecinizi WhatsApp ve Mail entegrasyonu ile otomatikleştirmek için adım adım talimatlar içerir.

## 📦 Gerekli Dosyalar

Bu sistemde 4 ana dosya bulunmaktadır:

1. **trello-automation-system.md** - Tam dokümantasyon ve sistem açıklaması
2. **make-automation-scenarios.json** - Make.com için hazır senaryo yapılandırmaları
3. **trello-butler-rules.json** - Trello Butler kuralları (harici araç gerektirmez)
4. **IMPLEMENTATION-GUIDE.md** - Bu dosya (hızlı başlangıç)

---

## ⚡ Hızlı Başlangıç (15 Dakika)

### Adım 1: Trello Panosu Kurulumu (5 dakika)

1. **Yeni Pano Oluşturun**
   ```
   Adı: YouTube İçerik Üretim Süreci
   Görünürlük: Workspace visible
   ```

2. **5 Liste Oluşturun** (tam bu sırayla):
   - Ham Görüntüler
   - Kurgu Aşamasında
   - Müşteri Onayında
   - Revize Bekliyor
   - Tamamlandı

3. **Custom Fields Power-Up Ekleyin**
   - Pano → Show Menu → Power-Ups → "Custom Fields" ara
   - "Enable" butonuna tıklayın

4. **3 Custom Field Oluşturun**
   - Settings → Custom Fields → "New Field"

   | Alan Adı | Tip |
   |:---------|:----|
   | Müşteri Telefon | Text |
   | Editör Mail | Text |
   | Video Linki | Text |

5. **Test Kartı Oluşturun**
   ```
   Başlık: [Test Müşteri] - Test Videosu
   Liste: Kurgu Aşamasında
   Custom Fields:
     - Müşteri Telefon: 905551234567
     - Editör Mail: your-email@example.com
     - Video Linki: https://example.com/video
   ```

---

### Adım 2A: Basit Yol - Trello Butler (5 dakika)

**Avantajları:**
- ✅ Harici araç gerekmez
- ✅ Kolay kurulum
- ✅ Trello içinde çalışır

**Dezavantajları:**
- ❌ WhatsApp entegrasyonu yok
- ❌ Sınırlı özelleştirme

**Kurulum:**

1. Trello panonuzda → Automation → Rules
2. Aşağıdaki kuralları ekleyin:

**Kural 1: Revize Bildirimi**
```
when a card is moved to list "Revize Bekliyor",
send an email to {customfield:Editör Mail}
with subject "Yeni Revize: {cardname}"
and message "Lütfen kartı kontrol edin: {cardlink}"
```

**Kural 2: Tamamlanma Etiketi**
```
when a card is moved to list "Tamamlandı",
add the green label to the card,
and add a comment "✅ Proje tamamlandı!"
```

**Kural 3: Gecikme Uyarısı**
```
every monday at 9:00 AM,
for each card in list "Revize Bekliyor",
if the card is older than 3 days,
add a comment "⚠️ Bu revize 3 gündür bekliyor!"
```

3. Her kuralı "Save" edin ve test için bir kartı hareket ettirin

📘 **Daha fazla kural için:** `trello-butler-rules.json` dosyasına bakın

---

### Adım 2B: Gelişmiş Yol - Make.com (10 dakika)

**Avantajları:**
- ✅ WhatsApp entegrasyonu
- ✅ Tam özelleştirme
- ✅ Kompleks workflow'lar

**Dezavantajları:**
- ❌ Harici hesap gerekir
- ❌ Daha karmaşık kurulum
- ❌ Aylık operasyon limiti

**Kurulum:**

#### 1. Make.com Hesabı Oluşturun
- [make.com](https://make.com) adresine gidin
- "Start free" ile kayıt olun (1,000 ücretsiz operasyon/ay)

#### 2. Trello Bağlantısı
- Make Dashboard → Connections → Add
- "Trello" ara ve seç
- Trello hesabınızı yetkilendirin

#### 3. İlk Senaryo: Trello → Mail

1. Create New Scenario
2. Add Module → Trello → "Watch Card Moved"
3. Yapılandırma:
   ```
   Board: [YouTube İçerik Üretim Süreci seçin]
   Webhook: Create new webhook
   ```
4. Add Module → Filter
   ```
   Condition: {{listAfter.name}} = "Revize Bekliyor"
   ```
5. Add Module → Trello → "Get a Card"
   ```
   Card ID: {{1.id}}
   ```
6. Add Module → Gmail → "Send an Email"
   ```
   To: {{customFieldItems.Editör Mail}}
   Subject: Yeni Revize: {{name}}
   Content: Müşteri için revize talebi geldi.
            Kart: {{url}}
   ```
7. "Save" ve "Run once" ile test edin

📘 **Tam senaryo yapılandırması:** `make-automation-scenarios.json` dosyasına bakın

#### 4. WhatsApp Entegrasyonu (İsteğe Bağlı)

WhatsApp Business API için:
1. [Twilio hesabı](https://twilio.com) oluşturun
2. WhatsApp Sandbox aktif edin (test için ücretsiz)
3. Make.com'da Twilio bağlantısı ekleyin
4. `make-automation-scenarios.json` içindeki "Senaryo A" yapılandırmasını kullanın

---

## 🧪 Test Senaryoları

### Test 1: Manuel Kart Taşıma
1. Test kartınızı "Revize Bekliyor" listesine taşıyın
2. **Beklenen:** Editör Mail adresine bildirim gitmeli
3. **Kontrol:** Email'inizi kontrol edin

### Test 2: Butler Kuralı
1. Bir kartı "Tamamlandı"ya taşıyın
2. **Beklenen:** Yeşil etiket eklenmeli, yorum eklenmiş olmalı
3. **Kontrol:** Kart detaylarını açın

### Test 3: Due Date (Varsa)
1. Bir karta yarın için due date ekleyin
2. **Beklenen:** Butler kuralı yarın tetiklenmeli
3. **Kontrol:** Ertesi gün kartı kontrol edin

---

## 📊 Kullanım İş Akışı

### Günlük Operasyon

1. **Yeni Proje Geldiğinde:**
   ```
   - "Ham Görüntüler" listesinde kart oluştur
   - Müşteri Telefon, Editör Mail alanlarını doldur
   - Editöre atama yap
   ```

2. **Kurgu Başladığında:**
   ```
   - Kartı "Kurgu Aşamasında"ya taşı
   - Due date ekle (tahmini teslim)
   ```

3. **Kurgu Tamamlandığında:**
   ```
   - Video Linki custom field'ına drive/youtube linki ekle
   - Kartı "Müşteri Onayında"ya taşı
   - WhatsApp'tan müşteriye link gönder
   ```

4. **Müşteri Revize İstediğinde:**
   ```
   MANUEL: Kartı "Revize Bekliyor"ya taşı, müşteri notunu yorum olarak ekle
   OTOMATİK (Make.com ile): WhatsApp mesajı otomatik olarak kartı taşır ve editöre mail gider
   ```

5. **Proje Onaylandığında:**
   ```
   - Kartı "Tamamlandı"ya taşı
   - 7 gün sonra otomatik arşivlenir
   ```

---

## 🔧 Sorun Giderme

### Problem: Butler email göndermiyor
**Çözüm:**
- Trello Business Class veya üstü plan gerekir
- Custom field adının tam eşleştiğinden emin olun: "Editör Mail"
- Email adresi formatının doğru olduğundan emin olun

### Problem: Make.com senaryosu çalışmıyor
**Çözüm:**
- Webhook'un aktif olduğunu kontrol edin
- Trello bağlantısını yeniden yetkilendirin
- "Run once" ile manuel test yapın
- Execution history'den hataları kontrol edin

### Problem: WhatsApp mesajları gelmiyor
**Çözüm:**
- Twilio webhook URL'sinin doğru olduğundan emin olun
- WhatsApp Sandbox'ta doğru numarayı kullandığınızdan emin olun
- Twilio console'da message logs kontrol edin

---

## 💰 Maliyet Hesaplaması

### Seçenek 1: Sadece Trello Butler
- **Trello Business Class:** $10/kullanıcı/ay
- **Toplam (2 kullanıcı):** ~$20/ay
- **Limit:** 50 Butler komutu/ay (ücretsiz planda)

### Seçenek 2: Make.com + Trello
- **Trello Free:** $0
- **Make.com Free:** $0 (1,000 operasyon/ay)
- **Twilio WhatsApp:** ~$0.005/mesaj
- **Toplam (düşük kullanımda):** $0-5/ay

### Seçenek 3: Make.com Pro
- **Make.com Core:** $9/ay (10,000 operasyon)
- **Twilio WhatsApp:** ~$20/ay (ağır kullanım)
- **Toplam:** ~$30/ay

---

## 📈 Sonraki Adımlar

### Seviye 1: Temel Kurulum ✅
- [x] Trello panosu oluşturuldu
- [x] Custom fields eklendi
- [x] Temel Butler kuralları aktif

### Seviye 2: Gelişmiş Otomasyon
- [ ] Make.com senaryoları kuruldu
- [ ] Gmail entegrasyonu aktif
- [ ] Test senaryoları başarıyla geçti

### Seviye 3: WhatsApp Entegrasyonu
- [ ] Twilio hesabı oluşturuldu
- [ ] WhatsApp Business API aktif
- [ ] Çift yönlü mesajlaşma çalışıyor

### Seviye 4: Analytics & Raporlama
- [ ] Google Sheets entegrasyonu
- [ ] Haftalık otomatik raporlar
- [ ] Dashboard kuruldu

---

## 📚 Ek Kaynaklar

### Dokümantasyon
- [Trello API](https://developer.atlassian.com/cloud/trello/)
- [Make.com Help Center](https://www.make.com/en/help/)
- [Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp)

### Video Tutorials
- Trello Butler: YouTube'da "Trello Butler tutorial" arayın
- Make.com: [Make Academy](https://www.make.com/en/academy)

### Destek
- Trello: [support@trello.com](mailto:support@trello.com)
- Make.com: help.make.com
- GrowLabs Dahili Destek: Sertan Kırço

---

## ✅ Checklist: Sistem Kurulumu Tamamlandı mı?

Aşağıdaki tüm maddeleri işaretleyebildiğinizde sistem kullanıma hazırdır:

- [ ] Trello panosu oluşturuldu ve 5 liste var
- [ ] Custom Fields Power-Up aktif
- [ ] 3 custom field oluşturuldu (Müşteri Telefon, Editör Mail, Video Linki)
- [ ] En az 1 Butler kuralı aktif ve test edildi
- [ ] Test kartı oluşturuldu ve başarıyla taşındı
- [ ] Email bildirimi geldi (Butler veya Make.com)
- [ ] Takım üyeleri sistemi kullanmayı biliyor
- [ ] İlk gerçek proje kartı oluşturuldu

---

**Tebrikler! 🎉**

YouTube içerik üretim süreciniz artık otomatik ve verimli. Sorularınız için `trello-automation-system.md` dosyasına bakın veya GrowLabs ekibiyle iletişime geçin.

**İyi çalışmalar! 🚀**
