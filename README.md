# Where2Eat

אתר לדירוג מנות במסעדות, עם קבוצות חברים והגרלת מקום לאכול.
אתר סטטי (HTML ו־JavaScript, בלי שלב build), עם Firebase Authentication ו־Firestore, ופריסה ב־Vercel.

## מבנה הקבצים

| קובץ | מה יש בו |
|---|---|
| `index.html` | המבנה והעיצוב |
| `app.js` | כל הלוגיקה של האתר |
| `firebase-config.js` | ההגדרות של פרויקט ה־Firebase שלך (צריך למלא) |
| `cities.js` | רשימת היישובים של הלמ״ס |
| `firestore.rules` | חוקי האבטחה של מסד הנתונים |
| `firebase.json` | הגדרה לפריסת החוקים דרך Firebase CLI (לא חובה) |

## הקמה

### 1. פרויקט Firebase
1. ב־[Firebase Console](https://console.firebase.google.com) יוצרים פרויקט חדש.
2. **Project settings ← General ← Your apps**: מוסיפים Web app (`</>`), ומעתיקים את אובייקט ה־`firebaseConfig` לקובץ `firebase-config.js`.

### 2. התחברות
**Authentication ← Sign-in method**, מפעילים שתי שיטות:
- **Email/Password** (ההתחברות עם שם משתמש וסיסמה עובדת דרכה)
- **Google**

### 3. מסד נתונים
1. **Firestore Database ← Create database**, במצב Production.
2. בלשונית **Rules** מדביקים את כל התוכן של `firestore.rules` ולוחצים **Publish**.

### 4. פריסה ב־Vercel
1. מעלים את התיקייה ל־GitHub.
2. ב־Vercel: **Add New ← Project**, בוחרים את ה־repo.
   - Framework Preset: **Other**
   - Build Command: ריק
   - Output Directory: ריק (השורש)
3. Deploy.

### 5. אישור הדומיין
**Authentication ← Settings ← Authorized domains**: מוסיפים את הכתובת שקיבלת מ־Vercel, למשל `where2eat.vercel.app`.
בלי זה ההתחברות עם Google לא תעבוד.

## הרצה מקומית
הקבצים משתמשים ב־ES modules, אז צריך שרת ולא פתיחה ישירה של הקובץ:
```bash
npx serve .
```
`localhost` כבר מאושר ב־Firebase כברירת מחדל.

## איך זה עובד

**הרשמה**
- עם **שם משתמש וסיסמה**: שם המשתמש נשמר כייחודי (בלי הבדל בין אותיות גדולות לקטנות), והסיסמה מנוהלת על ידי Firebase ולא נשמרת במסד הנתונים.
- עם **Google**: אחרי ההתחברות בוחרים שם משתמש ייחודי.
- הייחודיות נאכפת בטרנזקציה מול הקולקציה `usernames`, כך ששני אנשים לא יכולים לתפוס את אותו שם גם אם נרשמו באותו רגע.

**שחזור סיסמה**: למשתמשים עם שם משתמש וסיסמה אין כתובת מייל, ולכן אין שחזור סיסמה עצמאי. אם מישהו שכח סיסמה, אפשר למחוק את המשתמש ב־Authentication ← Users ולתת לו להירשם מחדש. מי שמתחבר עם Google לא צריך סיסמה.

**הרשאות** (מתוך `firestore.rules`)
- רק משתמשים מחוברים רואים נתונים.
- כל אחד משנה רק את הפרופיל ואת הדירוגים של עצמו.
- מסעדה או מנה יכול למחוק רק מי שהוסיף אותן. סימון הכשרות פתוח לתיקון על ידי כולם.
- קבוצות אי אפשר לערוך או למחוק אחרי שנוצרו. מצטרפים ויוצאים דרך הפרופיל.

**מבנה הנתונים ב־Firestore**
- `users/{uid}`: שם משתמש ורשימת קודי הקבוצות
- `usernames/{שם באותיות קטנות}`: למי שייך השם
- `groups/{קוד}`: שם הקבוצה
- `restaurants/{id}`: שם, קטגוריה, עיר, כשרות
- `dishes/{id}`: שם המנה והמסעדה שלה
- `ratings/{uid}`: כל הדירוגים של משתמש אחד, `{ stars: { dishId: 1..5 } }`
