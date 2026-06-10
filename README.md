# ⚽ World Cup 2026: Live Stock & Manager

> **Geleneksel fantezi futbolun ötesinde — Gerçek zamanlı bir futbol borsası.**
> Maç izlerken portföyünü yönet, performansla kazan, global rekabette zirveye çık.

---

## Vizyon

Piyasadaki menajerlik oyunları statik bir yapıya sahiptir: haftada bir transfer, sabit puan tablosu, sınırlı strateji alanı. **World Cup 2026: Live Stock & Manager** bu kalıbı kırıyor.

Bu oyunda **puan yoktur.** Her eylem nakde dönüşür. Kullanıcılar bir takım yöneticisi değil, bir **futbol portföyü yöneticisidir.** 2026 Dünya Kupası boyunca anlık performans verileriyle değer kazanan oyuncuları alır, satar ve döngüsel bir ekonomi içinde servetlerini büyütürler.

Basitlik ve dinamizm — aynı anda.

---

## Temel Oyun Mekanikleri

### Kadro Yapısı — 11 + 3

| Pozisyon | Sayı | Rolü |
|---|---|---|
| As Kadro | 11 | Ana gelir kaynağı; her performans anında nakit üretir |
| Yedek Kulübesi | 3 | Stratejik rezerv; nakit akışı veya acil satış için tutulur |

Kadro dolmadan önce transfer yapılabilir. Sınır yalnızca bütçedir.

---

### Canlı Performans Ekonomisi — Performance-to-Cash

Geleneksel puan sisteminin yerini tamamen nakit akışı alır:

| Olay | Etkilenen Pozisyon | Ödeme Tipi |
|---|---|---|
| Gol | Forvet, Orta Saha | Anlık yüksek nakit girişi |
| Asist | Orta Saha, Defans | Anlık nakit girişi |
| Clean Sheet | Kaleci, Defans | Maç sonu büyük bonus ödemesi |
| Sarı/Kırmızı Kart | Tüm pozisyonlar | Nakit kesintisi |
| İnsan Hataları (penaltı verme vb.) | Defans, Kaleci | Dinamik ceza |

> Maç canlı akarken kullanıcının cüzdanındaki rakam değişiyor. Bu his, oyunun kalbidir.

---

### Sınırsız Borsa — Unlimited Trading

- **Sıfır transfer limiti:** Para yettiği sürece, maç ortasında bile alım-satım yapılabilir.
- **Dinamik fiyatlandırma:** Oyuncu değerleri gerçek dünya performansı ve oyun içi arz-talep dengesine göre sürekli güncellenir.
- **Volatilite mekanizması:** Ani değer çöküşlerini ve balon oluşumlarını önleyen dengeleyici algoritmalar piyasayı stabil tutar.

---

## Büyük Ödül

Turnuva sonunda global liderlik tablosunda **1. sırayı** alan kullanıcıya:

> **Kendi tuttuğu takımın 2 adet sezonluk kombine bileti**

Saf finansal motivasyonun ötesinde, duygusal bağ kuran bir ödül yapısı. Tuttuğun takımı takip etmek artık bir rekabet haline geliyor.

---

## Teknik Mimari

### Genel Yaklaşım

Sistem, yüksek eşzamanlılık altında tutarlılığı garanti eden **event-driven** bir mikro-servis mimarisine dayanır. Tek bir gol eventi, etkilenen tüm kullanıcı cüzdanlarını **1 saniye altında** güncelleyebilecek şekilde tasarlanmıştır.

```
┌─────────────────────────────────────────────────────────────┐
│                    KULLANICI KATMANI                        │
│         Mobile App  ──  WebSocket  ──  Live Dashboard       │
└────────────────────────────┬────────────────────────────────┘
                             │ Gerçek Zamanlı Olaylar
┌────────────────────────────▼────────────────────────────────┐
│                    OLAY MOTORU (Event Bus)                  │
│   Sportradar / Opta API  →  Event Normalizer  →  Dispatcher │
└──────┬──────────────────────────┬───────────────────────────┘
       │                          │
┌──────▼──────────┐   ┌───────────▼──────────────────────────┐
│  MARKET ENGINE  │   │         WALLET ENGINE                │
│                 │   │                                      │
│ Fiyat Güncelle  │   │  reserveFunds()  ← Çift harcama     │
│ Volatilite Kont.│   │  commitReservation()    koruması     │
│ Arz/Talep Hesap │   │  rollbackReservation()               │
│                 │   │  credit()  ← Performans kazancı      │
└─────────────────┘   └──────────────────────────────────────┘
       │                          │
┌──────▼──────────────────────────▼───────────────────────────┐
│                  VERİ KATMANI                               │
│    Transactional DB  ──  Event Log  ──  Leaderboard Cache   │
└─────────────────────────────────────────────────────────────┘
```

---

### Wallet & Exchange Engine

Projenin finansal çekirdeği. Binlerce eşzamanlı transfer isteği altında **double-spending** (çift harcama) hatasını tamamen önler.

#### Çift Harcama Önleme — İki Katmanlı Koruma

**Sorun:** İki işlem aynı anda bakiyeyi okur, her ikisi de yeterli gördüğü için devam eder, toplam harcama bakiyeyi aşar.

**Çözüm: İki aşamalı rezervasyon protokolü**

```
Kullanıcı → buyPlayer(A, 600₺) ──┐
Kullanıcı → buyPlayer(B, 600₺) ──┘   Bakiye = 1000₺

KORUMA OLMADAN:
  Thread A okur 1000 → Thread B okur 1000
  → İkisi de 600₺ harcayabilir görür
  → Toplam 1200₺ harcanır  ✗  DOUBLE SPEND

KORUMA İLE (Per-user Async Mutex):
  Thread A kilit alır → reserved=600, available=400
  Thread B kilit alır → available=400 < 600 → HATA  ✓
```

| Aşama | Metot | Etkisi |
|---|---|---|
| **1. Kilitle** | `reserveFunds()` | `balance` sabit, `reserved` artar |
| **2a. Onayla** | `commitReservation()` | `balance` düşer, `reserved` sıfırlanır |
| **2b. Geri al** | `rollbackReservation()` | `reserved` serbest kalır, `balance` hiç değişmemiş |

#### Ek Güvenceler

| Mekanizma | Amacı |
|---|---|
| **Idempotency Key** | Ağ yeniden denemelerinde aynı işlem iki kez uygulanmaz |
| **Version Counter** | Her cüzdan güncellemesi izlenir; DB katmanında `WHERE version=N` güvencesine dönüşür |
| **Rollback Sonrası Key Temizliği** | Başarısız işlemler güvenle yeniden denenebilir |

---

### Persistent Veritabanı Katmanı (v0.6)

In-memory motorların yerine geçen, yatay ölçeklenebilir PostgreSQL-backed implementasyon:

| Bileşen | In-Memory (test) | PostgreSQL (production) |
|---|---|---|
| **Double-spend** | Per-user async mutex | `SELECT ... FOR UPDATE` |
| **İdempotency** | HashMap | `UNIQUE` kısıtlama + NULL trick |
| **Kapasitesi** | Tek işlem | N sunucu, aynı DB |
| **Bağlantı** | — | Wire protocol v3, sıfır bağımlılık |

```
DATABASE_URL=postgres://user:pass@db:5432/wc2026 npm start
```

Sistem başlatırken `DATABASE_URL` varsa:
1. `migrate()` → şema oluşturulur / güncellenir
2. `PgPool` (10 bağlantı) → `PgWalletEngine`, `PgSquadManager`, `PgMarketEngine` aktifleşir
3. `SELECT ... FOR UPDATE` → veritabanı seviyesinde kilitler in-memory mutex'i devre dışı bırakır

---

### Canlı Veri Entegrasyonu

```
Sportradar / Opta API
        │
        │  Low-latency webhook / polling
        ▼
  Event Normalizer
  ┌─────────────────────────────────────────┐
  │  {                                      │
  │    "event": "GOAL",                     │
  │    "playerId": "mbappe-7",              │
  │    "matchId": "fra-arg-semifinal",      │
  │    "minute": 34,                        │
  │    "timestamp": 1750000000000           │
  │  }                                      │
  └─────────────────────────────────────────┘
        │
        ▼
  Fan-out Service  →  etkilenen kullanıcı cüzdanları
                       < 1 saniye hedefi
```

**Hedef SLA:** Olay gerçekleşmesinden kullanıcı cüzdanı güncellenmesine kadar **≤ 1000ms**

---

### Piyasa Volatilite Motoru

Oyuncu değerlerinin gerçekçi kalması için üç değişken sürekli hesaplanır:

```
Değer(t) = Baz_Fiyat
         × Performans_Çarpanı(son 3 maç)
         × Talep_Katsayısı(alım / satım oranı)
         × Volatilite_Dampener(aşırı değerlenme limiti)
```

- **Ani çöküş koruması:** Değer tek bir maçta %30'dan fazla düşemez.
- **Balon önleme:** Talep patlamasında arz mekanizması devreye girer.

---

## Proje Yapısı

```
/
├── src/
│   ├── wallet/
│   │   ├── types.ts              — Domain modeli
│   │   ├── errors.ts             — Hata sınıfları
│   │   ├── WalletEngine.ts       — Atomik bakiye motoru (double-spend korumalı)
│   │   ├── SquadManager.ts       — 11+3 kadro kuralı
│   │   ├── ExchangeEngine.ts     — Alım/satım orkestrasyon
│   │   └── __tests__/
│   ├── events/
│   │   ├── types.ts              — MatchEvent, DispatchResult
│   │   ├── PerformanceCalculator.ts  — Ödül/ceza tablosu (8 event tipi × 4 pozisyon)
│   │   ├── EventPipeline.ts      — Ham event → cüzdan + piyasa güncellemesi
│   │   └── __tests__/
│   ├── market/
│   │   └── MarketEngine.ts       — Volatilite motoru (kayan talep penceresi)
│   ├── mock/
│   │   └── MatchSimulator.ts     — WC2026 oyuncu kadrosu + maç senaryoları
│   ├── context/
│   │   └── GameContext.ts        — createGameContext() + createPgContext()
│   ├── db/                       — v0.6: Kalıcı veritabanı katmanı
│   │   ├── PgClient.ts           — PostgreSQL wire protocol v3 (sıfır bağımlılık)
│   │   ├── PgPool.ts             — Bağlantı havuzu + withTransaction()
│   │   ├── schema.sql            — DDL: wallets, transactions, squads, market
│   │   ├── migrate.ts            — Migration runner
│   │   ├── PgWalletEngine.ts     — SELECT FOR UPDATE çift harcama koruması
│   │   ├── PgSquadManager.ts     — Transactional kadro yönetimi
│   │   ├── PgMarketEngine.ts     — Persistent fiyat geçmişi + volatilite
│   │   ├── PgExchangeEngine.ts   — Async alım/satım orkestrasyon
│   │   └── __tests__/db.test.ts  — Entegrasyon testleri (DATABASE_URL gerekir)
│   └── api/
│       ├── HttpRouter.ts         — Sıfır bağımlılıklı HTTP router
│       ├── handlers.ts           — 12 REST endpoint handler'ı
│       └── server.ts             — Sunucu bootstrap (PORT=3000, DATABASE_URL opsiyonel)
├── Landingpage                   — Tanıtım sayfası (HTML)
├── package.json
└── tsconfig.json
```

---

## REST API

Sunucuyu başlat:

```bash
NODE_PATH=/opt/node22/lib/node_modules \
  TS_NODE_TRANSPILE_ONLY=1 \
  node --require ts-node/register src/api/server.ts
```

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/players` | Piyasadaki tüm oyuncular |
| GET | `/market` | Anlık fiyat tablosu |
| GET | `/market/:playerId` | Oyuncu fiyatı + geçmişi |
| POST | `/users` | Kullanıcı oluştur |
| GET | `/wallet/:userId` | Cüzdan durumu |
| GET | `/wallet/:userId/history` | İşlem geçmişi |
| GET | `/squad/:userId` | Kadro görünümü |
| POST | `/transfer/buy` | Oyuncu satın al |
| POST | `/transfer/sell` | Oyuncu sat |
| POST | `/match/start` | Maç başlat |
| POST | `/match/event` | Canlı maç eventi gönder |
| GET | `/leaderboard` | Liderlik tablosu |

---

## Test Edilmiş Senaryolar

```
✓ Bakiyeyi aşan iki eşzamanlı satın alım → yalnızca biri kabul edilir
✓ 10 paralel istek → tutarlı bakiye, sıfır reserved leak
✓ Ağ retries → idempotency key ile tek işlem garantisi
✓ Rollback → available tam geri gelir, tekrar denenebilir
✓ 11+3 kapasite limiti → 12. ve 4. oyuncu reddedilir
✓ Performans kazancı → anlık bakiye güncellemesi
✓ Satın alma + satış döngüsü → uçtan uca tutarlılık
✓ Gol eventi → sahibi kullanıcı cüzdanı 200 coin artar
✓ Kırmızı kart → tüm pozisyonlarda −100 coin cezası
✓ Fiyat volatilite limiti → tek event maks ±%30 değişim
✓ Alım baskısı fiyatı artırır; satım baskısı fiyatı düşürür
✓ WC2026 final simülasyonu → 12 event, 2 kullanıcı, tutarlı sonuç
```

```
npm test

# tests 94  |  pass 94  |  fail 0

# PostgreSQL entegrasyon testleri (DATABASE_URL gerekir):
DATABASE_URL=postgres://user:pass@localhost/wc2026 npm run test:db
```

---

## Yol Haritası

| Aşama | Kapsam | Durum |
|---|---|---|
| **v0.1** | Wallet & Exchange Engine çekirdeği | ✅ Tamamlandı |
| **v0.2** | Performance Event Pipeline + Market Motoru | ✅ Tamamlandı |
| **v0.3** | REST API (12 endpoint, sıfır bağımlılık) | ✅ Tamamlandı |
| **v0.4** | WebSocket gerçek zamanlı push (RFC 6455, sıfır bağımlılık) | ✅ Tamamlandı |
| **v0.5** | DataFeedAdapter — Sportradar + Opta normalize + webhook güvenliği | ✅ Tamamlandı |
| **v0.6** | Persistent veritabanı (PostgreSQL + transactional kilit) | ✅ Tamamlandı |
| **v1.0** | Mobil uygulama (React Native) + Tinder-style UI | 2026 öncesi |

---

## Hedef Kitle & Gelir Modeli

**Kitle:** 2026 Dünya Kupası'nı takip eden, futbol ve strateji meraklısı global kullanıcılar.

| Kanal | Model |
|---|---|
| Uygulama içi reklamlar | CPM / CPC |
| Bütçe yükseltme paketleri | Micro-transaction (IAP) |
| Marka sponsorlu özel ligler | B2B sponsorluk |
| Premium üyelik | Gelişmiş analiz araçları, öncelikli destek |

---

## Katkı

Bu proje aktif geliştirme aşamasındadır. Katkıda bulunmadan önce açık issue listesini inceleyebilirsin.

```bash
git clone https://github.com/sertankirco/Growlabs-
cd Growlabs-
npm test
```

---

*World Cup 2026: Live Stock & Manager — Futbol izlemenin yeni anlamı.*
