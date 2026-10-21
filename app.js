import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, getDoc,
  runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { IL_CITIES } from "./cities.js";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").trim().replace(/\s+/g," ");
function loadScope(){ try{ return localStorage.getItem("scope")||"all"; }catch(_){ return "all"; } }
function saveScope(v){ try{ localStorage.setItem("scope",v); }catch(_){} }
function toast(msg){
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),2800);
}

const DEFAULT_CATS = ["המבורגר","אסייתי","איטלקי","מאפייה","יוגורט","עגלת קפה","מקסיקני","פיצה"];
const kosherOk = (r,k) => !k || (k==="yes" ? r.kosher===true : r.kosher===false);
const kosherText = r => r.kosher===true ? "כשר" : r.kosher===false ? "לא כשר" : "כשרות לא צוינה";

/* Usernames: 3–15 chars, Hebrew/English letters, digits, . _ -
   Password accounts sign in through a hidden technical email derived from the username. */
const USERNAME_RE = /^[A-Za-z0-9\u05D0-\u05EA_.\-]{3,15}$/;
const USERNAME_HINT = "3 עד 15 תווים: אותיות בעברית או באנגלית, ספרות, נקודה, מקף או קו תחתון, בלי רווחים.";
function techEmail(lower){
  const hex=[...new TextEncoder().encode(lower)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return `u${hex}@users.where2eat.app`;
}

/* ---------- state ---------- */
const configured = firebaseConfig?.apiKey && !String(firebaseConfig.apiKey).startsWith("YOUR");
let app, auth, db;
if (configured){ app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app); }

const S = {
  authReady:false, authUser:null, uid:null, busy:"", ready:false,
  restaurants:[], dishes:[], ratings:{}, members:{}, groups:{},
  ui:{q:"", city:"", cat:"", kosher:"", showAdd:false, drawCat:"", drawCity:"", drawKosher:"", drawResult:null, scope:loadScope()}
};

/* ---------- derived ---------- */
const me = () => S.uid ? S.members[S.uid] : null;
const registered = () => !!me();
let SC=null, VD=[], VR=[];
function dishRatings(dishId){
  const out=[];
  for (const [uid,d] of Object.entries(S.ratings)){
    if (SC && !SC.has(uid)) continue;
    const v=d?.stars?.[dishId];
    if (typeof v==="number" && v>=1 && v<=5) out.push({uid, stars:v, note:d?.notes?.[dishId]||"", name:S.members[uid]?.username || "משתמש"});
  }
  return out.sort((a,b)=>b.stars-a.stars || a.name.localeCompare(b.name,"he"));
}
const avg = list => list.length ? list.reduce((s,r)=>s+r.stars,0)/list.length : null;
const myGroups = () => (me()?.groups||[]).filter(c=>S.groups[c]);
const groupMembers = code => Object.keys(S.members).filter(u=>(S.members[u].groups||[]).includes(code));
function effScope(){
  const sc=S.ui.scope, gs=myGroups();
  if (!registered() || sc==="all") return "all";
  if (sc==="mine") return gs.length ? "mine" : "all";
  return gs.includes(sc) ? sc : "all";
}
function prep(){
  const sc=effScope();
  if (sc==="all") SC=null;
  else { SC=new Set([S.uid]); (sc==="mine"?myGroups():[sc]).forEach(c=>groupMembers(c).forEach(u=>SC.add(u))); }
  VD = SC ? S.dishes.filter(d=>SC.has(d.createdBy)||dishRatings(d.id).length) : S.dishes;
  const rset=new Set(VD.map(d=>d.restaurantId));
  VR = SC ? S.restaurants.filter(r=>SC.has(r.createdBy)||rset.has(r.id)) : S.restaurants;
}
const scopeLabel = () => { const sc=effScope(); return sc==="all"?"כל המשתמשים":sc==="mine"?"כל הקבוצות שלי":(S.groups[sc]?.name||""); };
function restaurantStats(rid){
  const dishes=VD.filter(d=>d.restaurantId===rid);
  const all=dishes.flatMap(d=>dishRatings(d.id));
  return {dishCount:dishes.length, avg:avg(all), count:all.length};
}
const cities = () => [...new Set(VR.map(r=>r.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"he"));
const cats = () => [...new Set(VR.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"he"));
const fmt = n => n==null ? "—" : n.toFixed(1);
const starsHTML = (v,size) => `<span class="stars" style="${size?`font-size:${size}`:""}" aria-label="${v==null?"אין דירוג":fmt(v)+" מתוך 5"}"><i style="width:${v==null?0:(v/5*100)}%"></i></span>`;

/* ---------- errors & writes ---------- */
function authMessage(e){
  const c=e?.code||"";
  if (["auth/invalid-credential","auth/wrong-password","auth/user-not-found","auth/invalid-email"].includes(c)) return "שם המשתמש או הסיסמה שגויים.";
  if (c==="auth/email-already-in-use") return "שם המשתמש הזה כבר תפוס. נסי שם אחר.";
  if (c==="auth/weak-password") return "הסיסמה חלשה מדי. בחרי לפחות 8 תווים.";
  if (c==="auth/too-many-requests") return "יותר מדי ניסיונות. נסי שוב בעוד כמה דקות.";
  if (c==="auth/network-request-failed") return "אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.";
  if (c==="auth/unauthorized-domain") return "הדומיין הזה לא מאושר ב־Firebase. הוסיפי אותו ב־Authentication ← Settings ← Authorized domains.";
  if (c==="auth/operation-not-allowed") return "שיטת ההתחברות הזו לא מופעלת ב־Firebase. הפעילי אותה ב־Authentication ← Sign-in method.";
  if (e?.message==="taken") return "שם המשתמש הזה כבר תפוס. נסי שם אחר.";
  return "משהו השתבש. נסי שוב.";
}
async function safe(fn, okMsg){
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch(e){
    console.error(e);
    toast(e?.code==="permission-denied" ? "אין הרשאה לפעולה הזו." : "השמירה נכשלה. נסי שוב בעוד רגע.");
    return false;
  }
}
async function claimUsername(uid, username){
  const lower=username.toLowerCase();
  await runTransaction(db, async tx=>{
    const nameRef=doc(db,"usernames",lower), userRef=doc(db,"users",uid);
    const nameSnap=await tx.get(nameRef), userSnap=await tx.get(userRef);
    if (nameSnap.exists() && nameSnap.data().uid!==uid) throw new Error("taken");
    const prev=userSnap.exists()?userSnap.data():null;
    if (prev?.usernameLower && prev.usernameLower!==lower) tx.delete(doc(db,"usernames",prev.usernameLower));
    if (!nameSnap.exists()) tx.set(nameRef,{uid});
    tx.set(userRef,{username, usernameLower:lower, groups:prev?.groups||[], joinedAt:prev?.joinedAt||Date.now()});
  });
}
let ratingQueue=Promise.resolve();
function saveMine(stars, notes, okMsg){
  S.ratings={...S.ratings,[S.uid]:{stars, notes}};
  render();
  // notes is only sent when there is at least one, so plain ratings work even before the rules allow notes
  const body=Object.keys(notes).length ? {stars, notes, updatedAt:Date.now()} : {stars, updatedAt:Date.now()};
  ratingQueue=ratingQueue.then(()=>safe(()=>setDoc(doc(db,"ratings",S.uid),body), okMsg));
}
function setRating(dishId, stars){
  const cur={...(S.ratings[S.uid]?.stars||{})}, notes={...(S.ratings[S.uid]?.notes||{})};
  if (stars==null){ delete cur[dishId]; delete notes[dishId]; } else cur[dishId]=stars;
  saveMine(cur, notes);
}
function setNote(dishId, text){
  const cur={...(S.ratings[S.uid]?.stars||{})}, notes={...(S.ratings[S.uid]?.notes||{})};
  if (!cur[dishId]){ toast("קודם בוחרים כוכבים, ואז אפשר להוסיף הערה."); return; }
  if (text) notes[dishId]=text; else delete notes[dishId];
  saveMine(cur, notes, text ? "ההערה נשמרה" : "ההערה נמחקה");
}
async function uniqueCode(){
  const A="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let t=0;t<8;t++){
    const a=new Uint32Array(6); crypto.getRandomValues(a);
    const c=[...a].map(x=>A[x%A.length]).join("");
    if (!S.groups[c] && !(await getDoc(doc(db,"groups",c))).exists()) return c;
  }
  throw new Error("no-code");
}

/* ---------- views ---------- */
function viewSetup(){
  return `<div class="setup"><h1>כמעט מוכן</h1>
  <p class="lede">צריך לחבר את האתר לפרויקט Firebase שלך.</p>
  <div class="note">פתחי את הקובץ <code>firebase-config.js</code> והדביקי בו את ההגדרות מ־Firebase Console. ההוראות המלאות נמצאות בקובץ <code>README.md</code>.</div></div>`;
}

function viewAuth(){
  const reg = route().name==="register";
  return `<div class="auth">
  <h1>${reg?"הרשמה":"התחברות"}</h1>
  <p class="lede">${reg?"בוחרים שם משתמש ייחודי וסיסמה, או נרשמים עם חשבון Google.":"נכנסים עם שם משתמש וסיסמה, או עם חשבון Google."}</p>
  <button class="btn gbtn" data-act="google" type="button">${reg?"הרשמה עם Google":"התחברות עם Google"}</button>
  <div class="divider">או</div>
  <form class="panel" id="${reg?"regForm":"loginForm"}" novalidate>
    <div class="field"><label for="au">שם משתמש</label><input type="text" id="au" name="username" autocomplete="username" maxlength="15" required autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label for="ap">סיסמה</label><input type="password" id="ap" name="password" autocomplete="${reg?"new-password":"current-password"}" required></div>
    ${reg?`<div class="field"><label for="ap2">אימות סיסמה</label><input type="password" id="ap2" autocomplete="new-password" required></div>
    <p class="hint">${USERNAME_HINT} סיסמה של 8 תווים לפחות.</p>`:""}
    <p class="err" id="authErr" role="alert">${esc(S.busy && S.busy!=="google" ? "" : "")}</p>
    <button class="btn" type="submit" style="width:100%" ${S.busy?"disabled":""}>${S.busy ? "רגע…" : reg?"יצירת חשבון":"התחברות"}</button>
  </form>
  <p class="switch">${reg?`כבר יש לך חשבון? <a href="#/login">להתחברות</a>`:`אין לך חשבון? <a href="#/register">להרשמה</a>`}</p>
  </div>`;
}

function suggestName(){
  const n=(S.authUser?.displayName||"").replace(/\s+/g,"_").replace(/[^A-Za-z0-9\u05D0-\u05EA_.\-]/g,"").slice(0,15);
  return n.length>=3 ? n : "";
}
function viewOnboard(){
  return `<div class="auth">
  <h1>עוד צעד אחד</h1>
  <p class="lede">בחרי שם משתמש ייחודי. הוא יופיע ליד כל דירוג שלך.</p>
  <form class="panel" id="onboardForm" autocomplete="off">
    <div class="field"><label for="ou">שם משתמש</label><input type="text" id="ou" maxlength="15" required value="${esc(suggestName())}" autocapitalize="off" spellcheck="false"></div>
    <p class="hint">${USERNAME_HINT}</p>
    <p class="err" id="authErr" role="alert"></p>
    <button class="btn" type="submit" style="width:100%">שמירה והמשך</button>
  </form>
  <p class="switch"><button class="linkbtn" data-act="logout">התנתקות</button></p>
  </div>`;
}

function scopeBar(){
  const gs=myGroups(); if (!gs.length) return "";
  const sc=effScope();
  return `<div class="scope"><label for="scope">מציג נתונים של</label><select id="scope">
    <option value="all" ${sc==="all"?"selected":""}>כל המשתמשים</option>
    <option value="mine" ${sc==="mine"?"selected":""}>כל הקבוצות שלי</option>
    ${gs.map(c=>`<option value="${esc(c)}" ${sc===c?"selected":""}>${esc(S.groups[c].name)}</option>`).join("")}
  </select></div>`;
}

function viewHome(){
  const u=S.ui, q=u.q.toLowerCase();
  const list=VR.filter(r=>(!u.city||r.city===u.city)&&(!u.cat||r.category===u.cat)&&kosherOk(r,u.kosher)&&
    (!q||r.name.toLowerCase().includes(q)||(r.city||"").toLowerCase().includes(q)));
  const groups={};
  for (const r of list) (groups[r.category||"בלי קטגוריה"] ||= []).push(r);
  const catNames=Object.keys(groups).sort((a,b)=>a.localeCompare(b,"he"));
  const catOpts=[...new Set([...DEFAULT_CATS, ...S.restaurants.map(r=>r.category).filter(Boolean)])];

  return `
  <h1>המסעדות שלנו</h1>
  <p class="lede">מוסיפים מסעדה, מדרגים מנות, ונותנים להגרלה להחליט.</p>
  ${scopeBar()}
  <div style="margin-bottom:18px">
    ${u.showAdd ? `
    <form class="panel" id="addRest" autocomplete="off">
      <div class="field"><label for="rn">שם המסעדה</label><input type="text" id="rn" maxlength="60" required></div>
      <div class="field" role="radiogroup" aria-labelledby="catLbl"><span id="catLbl" class="flabel">קטגוריה</span>
        <div class="chips" id="catPick">
          ${catOpts.map(c=>`<button type="button" class="chip" role="radio" aria-checked="false" data-pickcat="${esc(c)}">${esc(c)}</button>`).join("")}
          <button type="button" class="chip" role="radio" aria-checked="false" data-newcat>+ קטגוריה חדשה</button>
        </div>
        <input type="text" id="rcNew" maxlength="30" placeholder="שם הקטגוריה החדשה" hidden>
        <input type="hidden" id="rc">
      </div>
      <div class="field" role="radiogroup" aria-labelledby="kLbl"><span id="kLbl" class="flabel">כשרות</span>
        <div class="chips" id="kPick">
          <button type="button" class="chip" role="radio" aria-checked="false" data-pickk="yes">כשר</button>
          <button type="button" class="chip" role="radio" aria-checked="false" data-pickk="no">לא כשר</button>
        </div>
        <input type="hidden" id="rk">
      </div>
      <div class="field combo"><label for="rt">עיר</label><input type="text" id="rt" maxlength="40" required placeholder="התחילי להקליד, למשל: חיפה" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rtSug"><ul id="rtSug" role="listbox" hidden></ul></div>
      <p class="err" id="addErr"></p>
      <div class="row" style="flex-wrap:nowrap">
        <button class="btn" type="submit">הוספת מסעדה</button>
        <button class="btn ghost" type="button" data-act="cancelAdd">ביטול</button>
      </div>
    </form>` : `<button class="btn" data-act="showAdd">+ הוספת מסעדה</button>`}
  </div>

  ${S.restaurants.length ? `
  <div class="toolbar">
    <input type="search" id="q" placeholder="חיפוש לפי שם או עיר" value="${esc(u.q)}" aria-label="חיפוש">
    <select id="fcity" aria-label="סינון לפי עיר"><option value="">כל הערים</option>${cities().map(c=>`<option ${c===u.city?"selected":""}>${esc(c)}</option>`).join("")}</select>
    <select id="fkosher" aria-label="סינון לפי כשרות"><option value="">כשר ולא כשר</option><option value="yes" ${u.kosher==="yes"?"selected":""}>רק כשר</option><option value="no" ${u.kosher==="no"?"selected":""}>רק לא כשר</option></select>
  </div>
  <div class="chips" role="group" aria-label="קטגוריות">
    <button class="chip" data-cat="" aria-pressed="${!u.cat}">הכול</button>
    ${cats().map(c=>`<button class="chip" data-cat="${esc(c)}" aria-pressed="${c===u.cat}">${esc(c)}</button>`).join("")}
  </div>` : ""}

  ${!S.restaurants.length ? `<p class="empty">עוד אין מסעדות. הוסיפי את הראשונה, ואז אפשר להתחיל לדרג.</p>` :
    (SC && !VR.length) ? `<p class="empty">בתצוגה הנוכחית (${esc(scopeLabel())}) עוד אין מסעדות. אפשר להוסיף אחת או לעבור לכל המשתמשים.</p>` :
    !list.length ? `<p class="empty">אין מסעדות שמתאימות לסינון. נסי לנקות את החיפוש או לבחור עיר אחרת.</p>` :
    catNames.map(cat=>`
      <div class="cat-head"><h2>${esc(cat)}</h2><span>${groups[cat].length} מסעדות</span></div>
      <ul class="rlist">${groups[cat].sort((a,b)=>a.name.localeCompare(b.name,"he")).map(r=>{
        const st=restaurantStats(r.id);
        return `<li><a href="#/r/${esc(r.id)}">
          <span class="rname">${esc(r.name)}</span>
          <span class="rscore">${st.avg==null?`<span class="rmeta">טרם דורג</span>`:`<b>${fmt(st.avg)}</b>${starsHTML(st.avg,".8rem")}`}</span>
          <span class="rmeta">${esc(r.city)}${r.kosher===true?" · כשר":""} · ${st.dishCount} מנות</span>
        </a></li>`;}).join("")}</ul>`).join("")}
  `;
}

function viewRestaurant(id){
  const r=S.restaurants.find(x=>x.id===id);
  if (!r) return `<p class="empty">המסעדה לא נמצאה. אולי היא נמחקה.</p><a class="btn ghost" href="#/">חזרה לרשימה</a>`;
  const st=restaurantStats(id);
  const dishes=VD.filter(d=>d.restaurantId===id)
    .map(d=>({...d, list:dishRatings(d.id)})).map(d=>({...d, avg:avg(d.list)}))
    .sort((a,b)=>(b.avg??-1)-(a.avg??-1) || a.name.localeCompare(b.name,"he"));
  const mine=S.ratings[S.uid]?.stars||{}, myNotes=S.ratings[S.uid]?.notes||{};
  return `
  <a href="#/" class="linkbtn" style="text-decoration:none">→ כל המסעדות</a>
  <div style="margin-top:12px">${scopeBar()}</div>
  <div class="rest-head">
    <h1 style="margin-top:10px">${esc(r.name)}</h1>
    <div class="meta"><span class="tag">${esc(r.category)}</span><span class="tag">${esc(r.city)}</span><span class="tag">${kosherText(r)}</span>
      ${r.kosher===undefined
        ? `<button class="linkbtn" data-setk="yes" data-rid="${esc(r.id)}">סמני ככשר</button><button class="linkbtn" data-setk="no" data-rid="${esc(r.id)}">סמני כלא כשר</button>`
        : `<button class="linkbtn" data-setk="${r.kosher?"no":"yes"}" data-rid="${esc(r.id)}">${r.kosher?"שינוי ללא כשר":"שינוי לכשר"}</button>`}
      ${st.avg!=null?`<span>${starsHTML(st.avg)} <b>${fmt(st.avg)}</b> <span class="rmeta">(${st.count} דירוגים)</span></span>`:""}
    </div>
  </div>
  <form class="panel" id="addDish" autocomplete="off" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
    <div class="field" style="flex:1 1 220px;margin:0"><label for="dn">מנה חדשה</label><input type="text" id="dn" maxlength="60" placeholder="למשל: פסטה ארביאטה" required></div>
    <button class="btn" type="submit">הוספת מנה</button>
  </form>
  <h2>מנות</h2>
  ${!dishes.length ? `<p class="empty">עוד אין מנות. הוסיפי מנה ותני לה ציון ראשון.</p>` :
    dishes.map(d=>{
      const my=mine[d.id];
      return `<div class="dish">
        <div class="dish-top">
          <div class="dish-name">${esc(d.name)}</div>
          <div class="score ${d.avg==null?"none":""}"><b>${fmt(d.avg)}</b>${starsHTML(d.avg,".8rem")}<small>${d.list.length?`${d.list.length} דירוגים`:"אין דירוגים"}</small></div>
        </div>
        <div class="rate">
          <span class="rate-label">הציון שלך:</span>
          <span class="star-input" role="group" aria-label="דירוג ${esc(d.name)}">
            ${[1,2,3,4,5].map(n=>`<button type="button" class="${my>=n?"on":""}" data-rate="${esc(d.id)}" data-n="${n}" aria-label="${n} כוכבים" aria-pressed="${my===n}">★</button>`).join("")}
          </span>
          ${my?`<button class="linkbtn" data-unrate="${esc(d.id)}">הסרת הדירוג</button>`:""}
          ${d.createdBy===S.uid && !d.list.length?`<button class="linkbtn" data-deldish="${esc(d.id)}">מחיקת מנה</button>`:""}
        </div>
        ${my?`<form class="note-form" data-note="${esc(d.id)}" autocomplete="off">
          <input type="text" id="note-${esc(d.id)}" maxlength="200" placeholder="הערה על המנה (לא חובה)" value="${esc(myNotes[d.id]||"")}" aria-label="הערה על ${esc(d.name)}">
          <button class="btn small ghost" type="submit">שמירה</button>
        </form>`:""}
        ${d.list.length?`<details class="raters"><summary>מי דירג${d.list.some(x=>x.note)?" ומה כתבו":""}</summary><ul>
          ${d.list.map(x=>`<li><div class="rrow"><span>${esc(x.name)}${x.uid===S.uid?" (את)":""}</span>${starsHTML(x.stars)}</div>${x.note?`<div class="rnote">${esc(x.note)}</div>`:""}</li>`).join("")}
        </ul></details>`:""}
      </div>`;}).join("")}
  ${r.createdBy===S.uid?`<p style="margin-top:30px"><button class="linkbtn" data-delrest="${esc(r.id)}">מחיקת המסעדה</button></p>`:""}
  `;
}

function drawPool(){
  const u=S.ui;
  return VR.filter(r=>(!u.drawCat||r.category===u.drawCat)&&(!u.drawCity||r.city===u.drawCity)&&kosherOk(r,u.drawKosher));
}
function viewDraw(){
  const u=S.ui, pool=drawPool(), res=u.drawResult && S.restaurants.find(r=>r.id===u.drawResult);
  let best=null;
  if (res){
    best=S.dishes.filter(d=>d.restaurantId===res.id).map(d=>({n:d.name,a:avg(dishRatings(d.id))}))
      .filter(d=>d.a!=null).sort((a,b)=>b.a-a.a)[0];
  }
  return `
  <h1>הגרלת מקום לאכול</h1>
  <p class="lede">אפשר להגריל מכל המסעדות, או לצמצם לפי קטגוריה, עיר וכשרות.</p>
  ${scopeBar()}
  <div class="row">
    <div class="field"><label for="dcat">קטגוריה</label><select id="dcat"><option value="">כל הקטגוריות</option>${cats().map(c=>`<option ${c===u.drawCat?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label for="dcity">עיר</label><select id="dcity"><option value="">כל הערים</option>${cities().map(c=>`<option ${c===u.drawCity?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label for="dkosher">כשרות</label><select id="dkosher"><option value="">כשר ולא כשר</option><option value="yes" ${u.drawKosher==="yes"?"selected":""}>רק כשר</option><option value="no" ${u.drawKosher==="no"?"selected":""}>רק לא כשר</option></select></div>
  </div>
  <div class="reel-wrap" aria-live="polite">
    <div class="reel" id="reel">${res?esc(res.name):"?"}</div>
    <div class="reel-sub" id="reelSub">${res?`${esc(res.category)} · ${esc(res.city)}${res.kosher===true?" · כשר":""}${best?` · הכי שווה: ${esc(best.n)} (${fmt(best.a)})`:""}`:(pool.length?"לחצי והגורל יחליט":"")}</div>
    ${res?`<div class="reel-actions"><a class="btn" href="#/r/${esc(res.id)}">לעמוד המסעדה</a></div>`:""}
  </div>
  <button class="btn big-draw" data-act="draw" ${pool.length?"":"disabled"}>${res?"הגרלה נוספת":"הגרלה"}</button>
  <p class="pool">${pool.length?`ההגרלה תבחר מתוך ${pool.length} מסעדות`:(VR.length?"אין מסעדות שמתאימות לסינון הזה. שני קטגוריה, עיר או כשרות.":"קודם צריך להוסיף מסעדות.")}</p>
  `;
}

function viewSettings(){
  const m=me(), gs=myGroups();
  const viaGoogle=(S.authUser?.providerData||[]).some(p=>p.providerId==="google.com");
  return `
  <h1>ההגדרות שלך</h1>
  <p class="lede">מחוברת בתור <b>${esc(m.username)}</b>${viaGoogle?" דרך Google":""}.</p>
  <form class="panel" id="renameForm" autocomplete="off">
    <div class="field"><label for="un">שם משתמש</label><input type="text" id="un" maxlength="15" required value="${esc(m.username)}" autocapitalize="off" spellcheck="false"></div>
    <p class="hint">${USERNAME_HINT}${viaGoogle?"":" ההתחברות תמשיך לעבוד עם השם הקודם."}</p>
    <p class="err" id="renErr" role="alert"></p>
    <button class="btn" type="submit">שמירת השם</button>
  </form>

  <h2>הקבוצות שלי</h2>
  <p class="lede">בכל עמוד אפשר לבחור אם לראות מה הוסיפו ודירגו כל המשתמשים, כל הקבוצות שלך, או קבוצה אחת מסוימת.</p>
  ${gs.length?`<ul class="glist">${gs.map(c=>{ const g=S.groups[c], ms=groupMembers(c); return `<li>
      <div><b>${esc(g.name)}</b><div class="rmeta">${ms.length} חברים: ${ms.map(u=>esc(S.members[u].username)).join(", ")}</div></div>
      <div class="gcode"><code>${esc(c)}</code><button class="btn small ghost" data-copy="${esc(c)}">העתקת קוד</button><button class="linkbtn" data-leave="${esc(c)}">יציאה</button></div>
    </li>`; }).join("")}</ul>`
    :`<p class="empty" style="padding:6px 0 16px">עוד אין לך קבוצות. צרי קבוצה חדשה, או הצטרפי עם קוד שקיבלת.</p>`}
  <div class="row">
    <form class="panel" id="newGroup" autocomplete="off">
      <div class="field"><label for="gn">קבוצה חדשה</label><input type="text" id="gn" maxlength="30" placeholder="למשל: משפחה" required></div>
      <button class="btn" type="submit">יצירת קבוצה</button>
      <p class="rmeta" style="margin:8px 0 0">קוד ייחודי נוצר אוטומטית. שולחים אותו למי שרוצים לצרף.</p>
    </form>
    <form class="panel" id="joinGroup" autocomplete="off">
      <div class="field"><label for="gc">הצטרפות לקבוצה</label><input type="text" id="gc" maxlength="12" placeholder="קוד בן 6 תווים" required class="codein"></div>
      <button class="btn" type="submit">הצטרפות</button>
      <p class="err" id="joinErr" style="margin:8px 0 0"></p>
    </form>
  </div>
  <p style="margin-top:30px"><button class="btn ghost" data-act="logout">התנתקות</button></p>
  `;
}

/* ---------- render ---------- */
function route(){ const h=location.hash.replace(/^#\/?/,""); const [a,b]=h.split("/"); return {name:a||"home", id:b}; }
let pending=false;
function setPick(sel, btn){ document.querySelectorAll(sel+" [role=radio]").forEach(b=>b.setAttribute("aria-checked", b===btn?"true":"false")); }
function restoreAdd(keep, newOpen){
  for (const [id,v] of Object.entries(keep)){ const el=document.getElementById(id); if (el) el.value=v; }
  if (newOpen){ $("#rcNew").hidden=false; setPick("#catPick",$("[data-newcat]")); }
  else if (keep.rc) setPick("#catPick",[...document.querySelectorAll("[data-pickcat]")].find(b=>b.dataset.pickcat===keep.rc)||null);
  if (keep.rk) setPick("#kPick",document.querySelector(`[data-pickk="${keep.rk}"]`));
}
function render(force){
  const ae=document.activeElement;
  if (!force && ae && $("#app").contains(ae) && ae.matches("input[type=text],input[type=search],input[type=password]") && ae.value){ pending=true; return; }
  pending=false;
  const r=route();
  let html, signedInApp=false;
  if (!configured) html=viewSetup();
  else if (!S.authReady || S.busy==="creating") html=`<p class="empty">${S.busy==="creating"?"יוצרים את החשבון…":"טוען…"}</p>`;
  else if (!S.authUser) html=viewAuth();
  else if (!S.ready) html=`<p class="empty">טוען…</p>`;
  else if (!registered()) html=viewOnboard();
  else {
    signedInApp=true; prep();
    html = r.name==="r" ? viewRestaurant(r.id) : r.name==="draw" ? viewDraw() : r.name==="settings" ? viewSettings() : viewHome();
  }
  const focusId=ae?.id, caret=ae?.selectionStart;
  const keep={}; document.querySelectorAll("#addRest input[id]").forEach(i=>keep[i.id]=i.value);
  const newOpen=$("#rcNew") ? !$("#rcNew").hidden : false;
  $("#app").innerHTML=html;
  if ($("#addRest") && Object.keys(keep).length) restoreAdd(keep,newOpen);
  if (focusId){ const el=document.getElementById(focusId); if (el && el.matches("input")){ el.focus(); try{ el.setSelectionRange(caret,caret); }catch(_){} } }

  $("#tabs").hidden=!signedInApp;
  const tab = r.name==="draw" ? "draw" : (r.name==="home"||r.name==="r") ? "home" : "none";
  document.querySelectorAll("#tabs a").forEach(a=>{ if (a.dataset.tab===tab) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const who=$("#who");
  who.hidden=!signedInApp;
  if (signedInApp) who.textContent=me().username;
}
document.addEventListener("focusout", ()=>{ if (pending) setTimeout(()=>{ if (pending) render(); },0); });
window.addEventListener("hashchange", ()=>{ window.scrollTo(0,0); render(); });

/* ---------- events ---------- */
document.addEventListener("input", e=>{
  if (e.target.id==="q"){ S.ui.q=e.target.value; render(true); }
  if (e.target.id==="rt") showCitySug();
});
document.addEventListener("change", e=>{
  const id=e.target.id, v=e.target.value;
  if (id==="fcity"){ S.ui.city=v; render(); }
  if (id==="fkosher"){ S.ui.kosher=v; render(); }
  if (id==="scope"){ S.ui.scope=v; saveScope(v); S.ui.drawResult=null; S.ui.city=""; S.ui.cat=""; render(); }
  if (id==="dcat"){ S.ui.drawCat=v; S.ui.drawResult=null; render(); }
  if (id==="dcity"){ S.ui.drawCity=v; S.ui.drawResult=null; render(); }
  if (id==="dkosher"){ S.ui.drawKosher=v; S.ui.drawResult=null; render(); }
});

document.addEventListener("click", async e=>{
  const t=e.target.closest("button,[data-act]"); if (!t) return;
  const act=t.dataset.act;
  if (act==="google"){ googleSignIn(); return; }
  if (act==="logout"){ await signOut(auth); location.hash="#/login"; return; }
  if (t.dataset.pickcat!==undefined){ setPick("#catPick",t); $("#rc").value=t.dataset.pickcat; const n=$("#rcNew"); n.hidden=true; n.value=""; return; }
  if (t.hasAttribute("data-newcat")){ setPick("#catPick",t); $("#rc").value=""; const n=$("#rcNew"); n.hidden=false; n.focus(); return; }
  if (t.dataset.pickk){ setPick("#kPick",t); $("#rk").value=t.dataset.pickk; return; }
  if (t.dataset.setk){ await safe(()=>updateDoc(doc(db,"restaurants",t.dataset.rid),{kosher:t.dataset.setk==="yes"}),"הכשרות עודכנה"); return; }
  if (t.dataset.cat!==undefined){ S.ui.cat=t.dataset.cat; render(); return; }
  if (act==="showAdd"){ S.ui.showAdd=true; render(); $("#rn")?.focus(); return; }
  if (act==="cancelAdd"){ S.ui.showAdd=false; document.activeElement?.blur(); pending=false; render(); return; }
  if (act==="draw"){ doDraw(); return; }
  if (t.dataset.rate){ const n=+t.dataset.n; const cur=S.ratings[S.uid]?.stars?.[t.dataset.rate]; setRating(t.dataset.rate, cur===n?null:n); return; }
  if (t.dataset.unrate){ setRating(t.dataset.unrate,null); return; }
  if (t.dataset.copy){ try{ await navigator.clipboard.writeText(t.dataset.copy); toast("הקוד הועתק"); }catch(_){ toast("הקוד: "+t.dataset.copy); } return; }
  if (t.dataset.leave){
    const c=t.dataset.leave;
    if (!confirm(`לצאת מהקבוצה ${S.groups[c]?.name||""}?`)) return;
    await safe(()=>updateDoc(doc(db,"users",S.uid),{groups:arrayRemove(c)}),"יצאת מהקבוצה");
    return;
  }
  if (t.dataset.deldish){ if (!confirm("למחוק את המנה?")) return; await safe(()=>deleteDoc(doc(db,"dishes",t.dataset.deldish)),"המנה נמחקה"); return; }
  if (t.dataset.delrest){
    if (!confirm("למחוק את המסעדה ואת כל המנות שלה?")) return;
    const rid=t.dataset.delrest;
    const ok=await safe(async()=>{
      for (const d of S.dishes.filter(d=>d.restaurantId===rid)) await deleteDoc(doc(db,"dishes",d.id));
      await deleteDoc(doc(db,"restaurants",rid));
    },"המסעדה נמחקה");
    if (ok) location.hash="#/";
  }
});

async function googleSignIn(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  try { await signInWithPopup(auth,provider); }
  catch(e){
    if (e?.code==="auth/popup-blocked" || e?.code==="auth/operation-not-supported-in-this-environment"){ await signInWithRedirect(auth,provider); return; }
    if (e?.code==="auth/popup-closed-by-user" || e?.code==="auth/cancelled-popup-request") return;
    const el=$("#authErr"); if (el) el.textContent=authMessage(e); else toast(authMessage(e));
  }
}

document.addEventListener("submit", async e=>{
  e.preventDefault();
  const f=e.target, btn=f.querySelector("button[type=submit]");

  if (f.id==="loginForm"){
    const err=$("#authErr"), name=norm($("#au").value), pw=$("#ap").value;
    if (!name||!pw){ err.textContent="צריך למלא שם משתמש וסיסמה."; return; }
    btn.disabled=true;
    try { await signInWithEmailAndPassword(auth, techEmail(name.toLowerCase()), pw); location.hash="#/"; }
    catch(x){ err.textContent=authMessage(x); btn.disabled=false; }
    return;
  }

  if (f.id==="regForm"){
    const err=$("#authErr"), name=norm($("#au").value), pw=$("#ap").value, pw2=$("#ap2").value;
    if (!USERNAME_RE.test(name)){ err.textContent=USERNAME_HINT; return; }
    if (pw.length<8){ err.textContent="הסיסמה צריכה להכיל לפחות 8 תווים."; return; }
    if (pw!==pw2){ err.textContent="הסיסמאות לא זהות."; return; }
    btn.disabled=true;
    try {
      if ((await getDoc(doc(db,"usernames",name.toLowerCase()))).exists()) throw new Error("taken");
      S.busy="creating"; render(true);
      const cred=await createUserWithEmailAndPassword(auth, techEmail(name.toLowerCase()), pw);
      try { await claimUsername(cred.user.uid, name); }
      catch(x){ await cred.user.delete().catch(()=>{}); throw x; }
      S.busy=""; location.hash="#/"; render(true);
      toast("נרשמת בהצלחה");
    } catch(x){
      S.busy=""; render(true);
      const el=$("#authErr"); if (el) el.textContent=authMessage(x); else toast(authMessage(x));
    }
    return;
  }

  if (f.id==="onboardForm" || f.id==="renameForm"){
    const inp=f.querySelector("input"), err=f.querySelector(".err"), name=norm(inp.value);
    if (!USERNAME_RE.test(name)){ err.textContent=USERNAME_HINT; return; }
    if (me() && name===me().username){ err.textContent="זה כבר השם שלך."; return; }
    btn.disabled=true;
    try {
      await claimUsername(S.uid, name);
      document.activeElement?.blur(); pending=false;
      toast(f.id==="onboardForm"?"נרשמת בהצלחה":"השם נשמר");
      if (f.id==="onboardForm") location.hash="#/";
      render(true);
    } catch(x){ err.textContent=authMessage(x); btn.disabled=false; }
    return;
  }

  if (f.id==="addRest"){
    const name=norm($("#rn").value), city=norm($("#rt").value), k=$("#rk").value;
    const category=norm($("#rcNew").hidden ? $("#rc").value : $("#rcNew").value);
    if (!name||!category||!city){ $("#addErr").textContent="צריך למלא שם, לבחור קטגוריה ולכתוב עיר."; return; }
    if (!k){ $("#addErr").textContent="סמני אם המקום כשר או לא."; return; }
    if (S.restaurants.some(r=>r.name.toLowerCase()===name.toLowerCase() && r.city===city)){ $("#addErr").textContent="המסעדה הזו כבר ברשימה בעיר הזו."; return; }
    btn.disabled=true;
    let ref;
    const ok=await safe(async()=>{ ref=await addDoc(collection(db,"restaurants"),{name,category,city,kosher:k==="yes",createdBy:S.uid,createdAt:Date.now()}); },"המסעדה נוספה");
    document.activeElement?.blur(); pending=false;
    if (ok){ S.ui.showAdd=false; location.hash="#/r/"+ref.id; } else { btn.disabled=false; }
    return;
  }

  if (f.classList.contains("note-form")){
    const inp=f.querySelector("input"); inp.blur(); pending=false;
    setNote(f.dataset.note, norm(inp.value));
    return;
  }

  if (f.id==="addDish"){
    const rid=route().id, name=norm($("#dn").value);
    if (!name) return;
    if (S.dishes.some(d=>d.restaurantId===rid && d.name.toLowerCase()===name.toLowerCase())){ toast("המנה הזו כבר קיימת במסעדה."); return; }
    btn.disabled=true; $("#dn").value=""; document.activeElement?.blur(); pending=false;
    await safe(()=>addDoc(collection(db,"dishes"),{restaurantId:rid,name,createdBy:S.uid,createdAt:Date.now()}),"המנה נוספה");
    render();
    return;
  }

  if (f.id==="newGroup"){
    const name=norm($("#gn").value);
    if (name.length<2){ toast("שם הקבוצה צריך להכיל לפחות 2 תווים."); return; }
    btn.disabled=true;
    let code;
    const ok=await safe(async()=>{
      code=await uniqueCode();
      await setDoc(doc(db,"groups",code),{name,createdBy:S.uid,createdAt:Date.now()});
      await updateDoc(doc(db,"users",S.uid),{groups:arrayUnion(code)});
    });
    document.activeElement?.blur(); pending=false;
    if (ok) toast(`הקבוצה נוצרה. הקוד שלה: ${code}`);
    render();
    return;
  }

  if (f.id==="joinGroup"){
    const err=$("#joinErr"), code=$("#gc").value.toUpperCase().replace(/[^A-Z0-9]/g,"");
    if (code.length!==6){ err.textContent="הקוד צריך להכיל 6 תווים."; return; }
    if ((me().groups||[]).includes(code)){ err.textContent="את כבר בקבוצה הזו."; return; }
    btn.disabled=true;
    let exists=!!S.groups[code];
    if (!exists){ try{ exists=(await getDoc(doc(db,"groups",code))).exists(); }catch(_){} }
    if (!exists){ err.textContent="לא נמצאה קבוצה עם הקוד הזה. בדקי שהוא הועתק נכון."; btn.disabled=false; return; }
    document.activeElement?.blur(); pending=false;
    await safe(()=>updateDoc(doc(db,"users",S.uid),{groups:arrayUnion(code)}),"הצטרפת לקבוצה");
    render();
  }
});

/* ---------- city autocomplete ---------- */
let sugIdx=-1;
function citySuggest(v){
  const q=norm(v); if (!q) return [];
  const all=[...new Set([...S.restaurants.map(r=>r.city).filter(Boolean), ...IL_CITIES])];
  const starts=[], has=[];
  for (const c of all){ if (c.startsWith(q)) starts.push(c); else if (c.includes(q)) has.push(c); }
  return [...starts.sort((a,b)=>a.length-b.length), ...has].slice(0,8);
}
function showCitySug(){
  const inp=$("#rt"), ul=$("#rtSug"); if (!inp||!ul) return;
  const list=citySuggest(inp.value), q=norm(inp.value);
  sugIdx=-1;
  if (!list.length || (list.length===1 && list[0]===q)){ ul.hidden=true; inp.setAttribute("aria-expanded","false"); return; }
  ul.innerHTML=list.map((c,i)=>{ const k=c.indexOf(q); return `<li role="option" id="rtOpt${i}" data-city="${esc(c)}" aria-selected="false">${esc(c.slice(0,k))}<mark>${esc(c.slice(k,k+q.length))}</mark>${esc(c.slice(k+q.length))}</li>`; }).join("");
  ul.hidden=false; inp.setAttribute("aria-expanded","true");
}
function hideCitySug(){ const ul=$("#rtSug"); if (ul){ ul.hidden=true; $("#rt")?.setAttribute("aria-expanded","false"); } sugIdx=-1; }
function pickCity(c){ const inp=$("#rt"); inp.value=c; hideCitySug(); inp.focus(); }
document.addEventListener("mousedown", e=>{ const li=e.target.closest("#rtSug li"); if (li){ e.preventDefault(); pickCity(li.dataset.city); } });
document.addEventListener("keydown", e=>{
  if (e.target.id!=="rt") return;
  const ul=$("#rtSug"); if (!ul||ul.hidden) return;
  const items=[...ul.querySelectorAll("li")];
  if (e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();
    sugIdx=(sugIdx+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;
    items.forEach((li,i)=>li.setAttribute("aria-selected", i===sugIdx));
    e.target.setAttribute("aria-activedescendant","rtOpt"+sugIdx);
    items[sugIdx].scrollIntoView({block:"nearest"});
  } else if (e.key==="Enter" && sugIdx>=0){ e.preventDefault(); pickCity(items[sugIdx].dataset.city); }
  else if (e.key==="Escape") hideCitySug();
});
document.addEventListener("focusout", e=>{ if (e.target.id==="rt") setTimeout(hideCitySug,120); });

/* ---------- draw ---------- */
let drawing=false;
function doDraw(){
  const pool=drawPool(); if (!pool.length||drawing) return;
  const pick=pool[Math.floor(Math.random()*pool.length)];
  const reel=$("#reel"), sub=$("#reelSub");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length===1){ S.ui.drawResult=pick.id; render(); return; }
  drawing=true; reel.classList.remove("landed"); reel.classList.add("spinning"); sub.textContent="מגרילים…";
  let i=0, delay=60;
  const step=()=>{
    i++; reel.textContent=pool[Math.floor(Math.random()*pool.length)].name;
    if (i<22){ delay*=1.11; setTimeout(step,delay); }
    else { drawing=false; S.ui.drawResult=pick.id; render(); $("#reel")?.classList.add("landed"); }
  };
  step();
}

/* ---------- data ---------- */
let unsubs=[];
function subscribe(){
  const seen=new Set();
  const sub=(name, fn)=>unsubs.push(onSnapshot(collection(db,name), snap=>{
    fn(snap); seen.add(name); if (seen.size>=5) S.ready=true; render();
  }, err=>{ console.error(name, err); toast("אין גישה לנתונים. בדקי שחוקי האבטחה ב־Firestore פורסמו."); }));
  sub("restaurants", s=>{ S.restaurants=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.name); });
  sub("dishes", s=>{ S.dishes=s.docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.name&&d.restaurantId); });
  sub("ratings", s=>{ const m={}; s.docs.forEach(d=>m[d.id]=d.data()); S.ratings=m; });
  sub("users", s=>{ const m={}; s.docs.forEach(d=>{ const v=d.data(); if (v?.username) m[d.id]=v; }); S.members=m; });
  sub("groups", s=>{ const m={}; s.docs.forEach(d=>{ const v=d.data(); if (v?.name) m[d.id]=v; }); S.groups=m; });
}
function unsubscribe(){ unsubs.forEach(u=>u()); unsubs=[]; }

if (configured){
  onAuthStateChanged(auth, user=>{
    S.authReady=true;
    if (user?.uid!==S.uid){
      unsubscribe();
      Object.assign(S,{restaurants:[],dishes:[],ratings:{},members:{},groups:{},ready:false});
    }
    S.authUser=user; S.uid=user?.uid||null;
    if (user && !unsubs.length) subscribe();
    if (!user && !["login","register"].includes(route().name)) location.hash="#/login";
    render();
  });
}
render();
