# Chicken Shooting

Chicken Shooting je jednostavna browser igra napravljena u **PHP**, **JavaScript**, **HTML/CSS** i **SQLite**.  
Igrač ima 45 sekundi da pogodi što više kokošaka, osvoji što više poena i, ako je prijavljen, sačuva rezultat na leaderboard.

## Glavne funkcionalnosti

- registracija korisnika
- prijava i odjava korisnika
- čuvanje sesije preko PHP session-a
- lokalni best score preko `localStorage`
- globalni leaderboard sa najboljim rezultatima
- automatsko čuvanje rezultata za prijavljene korisnike
- različite vrste kokošaka sa različitim brzinama i brojem poena
- sistem municije i automatskog reload-a
- pause meni
- restart igre
- responzivan prikaz za desktop i mobilne uređaje

## Kako igra funkcioniše

- partija traje **45 sekundi**
- igrač počinje sa **6 metaka**
- kada ostane bez municije, aktivira se **automatski reload**
- pogodak donosi poene u zavisnosti od vrste kokoške
- promašaj oduzima **2 poena**
- po završetku partije:
  - ako je korisnik prijavljen, rezultat se čuva u bazi
  - leaderboard se osvežava
  - najbolji lokalni rezultat se čuva u `localStorage`

## Tehnologije

- **PHP 8+**
- **SQLite**
- **PDO**
- **JavaScript (Vanilla JS)**
- **HTML5**
- **CSS3**

## Struktura baze

Aplikacija automatski kreira SQLite bazu i potrebne tabele pri prvom pokretanju.

### Tabela `users`
Sadrži podatke o korisnicima:

- `id`
- `username`
- `nickname`
- `password_hash`
- `created_at`

### Tabela `scores`
Sadrži rezultate partija:

- `id`
- `user_id`
- `score`
- `created_at`

## Pokretanje aplikacije

### 1. Kloniraj ili preuzmi projekat
Smesti fajl aplikacije u folder na svom računaru ili serveru.

### 2. Proveri da li je PHP instaliran
U terminalu pokreni:

```bash
php -v
