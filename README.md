# GrowLabs Agency - Dijital Çözümler

GrowLabs Agency, 40-50 yaş arası kadın girişimciler için ölçülebilir dijital strateji, içerik ve teknoloji çözümleri sunar.

## 📁 Proje Yapısı

Bu repository aşağıdaki dosyaları içermektedir:

### 🌐 Web Sayfası
- **Landingpage** - GrowLabs Agency ana landing page (HTML/CSS/JS)

### 🤖 Trello Otomasyon Sistemi
YouTube içerik üretim sürecini WhatsApp ve Mail ile entegre eden otomasyon sistemi:

1. **IMPLEMENTATION-GUIDE.md** - ⚡ Buradan başlayın! Hızlı kurulum kılavuzu
2. **trello-automation-system.md** - Detaylı sistem dokümantasyonu
3. **make-automation-scenarios.json** - Make.com otomasyon senaryoları (JSON yapılandırma)
4. **trello-butler-rules.json** - Trello Butler kuralları (harici araç gerektirmez)

## 🚀 Hızlı Başlangıç

### Landing Page'i Görüntülemek İçin
```bash
# Dosyayı tarayıcıda açın
open Landingpage
# veya
firefox Landingpage
# veya
google-chrome Landingpage
```

### Trello Otomasyon Sistemini Kurmak İçin
```bash
# İlk olarak implementation guide'ı okuyun
cat IMPLEMENTATION-GUIDE.md

# veya markdown viewer ile
mdless IMPLEMENTATION-GUIDE.md
```

**Önerilen sıra:**
1. **IMPLEMENTATION-GUIDE.md** - 15 dakikalık hızlı kurulum
2. **trello-automation-system.md** - Detaylı sistem mimarisi
3. **make-automation-scenarios.json** - Make.com için hazır yapılandırma
4. **trello-butler-rules.json** - Butler kuralları referansı

## 🎯 Trello Otomasyon Sistemi Özellikleri

### Ana Özellikler
- ✅ YouTube içerik üretim süreç yönetimi
- ✅ WhatsApp entegrasyonu (Make.com ile)
- ✅ Otomatik email bildirimleri editörlere
- ✅ Müşteri revize takibi
- ✅ Gecikme uyarıları
- ✅ Otomatik raporlama

### Pano Listeleri
1. **Ham Görüntüler** - Çekim tamamlanmış videolar
2. **Kurgu Aşamasında** - Aktif editör projeleri
3. **Müşteri Onayında** - Onay bekleyen videolar
4. **Revize Bekliyor** - Revize talepleri
5. **Tamamlandı** - Yayına hazır projeler

### İş Akışı
```
Ham Görüntüler → Kurgu → Müşteri Onayı → Revize (gerekirse) → Tamamlandı
                                ↓
                        WhatsApp Mesajı
                                ↓
                        Editöre Otomatik Mail
```

## 💼 Hizmetler

GrowLabs Agency olarak sunduğumuz hizmetler:

- 🔹 **Sosyal Medya Yönetimi** - İçerik takvimi, görsel üretimi, reklam yönetimi
- 🔹 **Web & E-Ticaret** - Dönüşüm odaklı, SEO optimize web siteleri
- 🔹 **Marka Danışmanlığı** - Marka kimliği, hedef kitle analizi
- 🔹 **Dijital Reklam Yönetimi** - Facebook, Instagram, Google kampanyaları

## 📊 Teknoloji Stack

### Landing Page
- HTML5
- CSS3 (Custom properties, Grid, Flexbox)
- Vanilla JavaScript
- Responsive design
- Interactive slider

### Otomasyon Sistemi
- Trello API
- Make.com (iPaaS)
- WhatsApp Business API (Twilio)
- Gmail/SMTP
- Trello Butler (native automation)

## 🔧 Kurulum Gereksinimleri

### Landing Page
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Herhangi bir sunucu gerekmez (statik HTML)

### Trello Otomasyon
- Trello hesabı (Free veya Business Class)
- Make.com hesabı (Free tier: 1,000 operasyon/ay)
- Gmail hesabı (email bildirimleri için)
- Twilio hesabı (isteğe bağlı - WhatsApp entegrasyonu için)

## 📈 Kullanım Senaryoları

### Senaryo 1: Basit Başlangıç (Trello Butler)
- Harici araç gerekmez
- Email bildirimleri
- Otomatik etiketleme
- Ücretsiz başlangıç için ideal

### Senaryo 2: Gelişmiş (Make.com)
- WhatsApp entegrasyonu
- Kompleks workflow'lar
- Custom logic
- Yüksek hacimli operasyonlar için

## 💰 Maliyet

| Çözüm | Aylık Maliyet | Özellikler |
|:------|:--------------|:-----------|
| Trello Butler (Free) | $0 | 50 komut/ay limit |
| Trello Business Class | $10/kullanıcı | Sınırsız Butler |
| Make.com Free | $0 | 1,000 operasyon/ay |
| Make.com Core | $9 | 10,000 operasyon/ay |
| Twilio WhatsApp | $0.005/mesaj | WhatsApp entegrasyonu |

## 📞 İletişim

**GrowLabs Agency**
- 📧 Email: hello@growlabsagency.com
- 📍 Adres: Mecidiyeköy, İstanbul
- 🌐 Website: [GrowLabs Agency](/)

## 👥 Ekip

- **Sertan Kırço** - Dijital Strateji & Marka Danışmanı
- **Görsel & İçerik Ekibi** - Görsel üretim ve hikâye anlatımı
- **Analitik & Reklam** - Veri temelli reklam optimizasyonu

## 📝 Lisans

© 2026 GrowLabs Agency. Tüm hakları saklıdır.

## 🤝 Katkıda Bulunma

Bu proje GrowLabs Agency için özel olarak geliştirilmiştir. Sorularınız için lütfen ekiple iletişime geçin.

## 📚 Dokümantasyon Dizini

### Yeni Başlayanlar İçin
1. Bu README dosyasını okuyun
2. `IMPLEMENTATION-GUIDE.md` ile kuruluma başlayın
3. Landing page'i tarayıcınızda açın

### İleri Seviye
1. `trello-automation-system.md` - Sistem mimarisi
2. `make-automation-scenarios.json` - Otomasyon detayları
3. `trello-butler-rules.json` - Butler kuralları

---

**Son güncelleme:** 15 Ocak 2026

**Versiyon:** 1.0.0

**Durum:** ✅ Production Ready
