const SB_URL = "https://xxdgkwhzldsbweosezze.supabase.co";
const SB_KEY = "sb_publishable_W8vwFN9P1dEBSRNArGGlyg_iNHFz6GS";
const sb = supabase.createClient(SB_URL, SB_KEY);

const $ = id => document.getElementById(id);
let me = null, myName = "", anon = false;
let users = [], seen = new Set(), rec = null, chunks = [], channel = null;
let mode = "login", lastKey = null, lastTime = 0;

try { anon = localStorage.getItem("op_anon") === "1"; } catch (e) {}

/* ---------- AUTH ---------- */
$("sw").onclick = () => {
  mode = mode === "login" ? "signup" : "login";
  $("un").hidden = mode === "login";
  $("go").textContent = mode === "login" ? "Log in" : "Sign up";
  $("sw").textContent = mode === "login" ? "No account? Sign up" : "Have an account? Log in";
  $("err").textContent = "";
};

$("go").onclick = async () => {
  const email = $("email").value.trim(), pw = $("pw").value;
  const un = $("un").value.trim().toLowerCase();
  $("err").textContent = "";
  try {
    if (mode === "signup") {
      if (!/^[a-z0-9_]{3,20}$/.test(un)) throw new Error("Username: 3-20 letters, numbers or _");
      const { data: taken } = await sb.from("profiles").select("id").eq("username", un).maybeSingle();
      if (taken) throw new Error("Username already taken");
      const { data, error } = await sb.auth.signUp({ email, password: pw });
      if (error) throw error;
      if (!data.session) throw new Error("Confirm your email, then log in.");
      const { error: e2 } = await sb.from("profiles").insert({ id: data.user.id, username: un });
      if (e2) throw new Error(e2.code === "23505" ? "Username already taken" : e2.message);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
    }
    await start();
  } catch (e) { $("err").textContent = e.message; }
};

$("out").onclick = async () => {
  if (channel) { sb.removeChannel(channel); channel = null; }
  await sb.auth.signOut();
  location.reload();
};

/* ---------- START ---------- */
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  me = session.user;
  const { data: p } = await sb.from("profiles").select("username").eq("id", me.id).maybeSingle();
  if (!p) {
    await sb.auth.signOut();
    $("err").textContent = "No profile found. Sign up again with a new email.";
    return;
  }
  myName = p.username;
  $("auth").hidden = true;
  $("chat").hidden = false;
  paintAnon();
  await loadUsers();

  const { data } = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(100);
  $("list").innerHTML = "";
  seen.clear(); lastKey = null; lastTime = 0;
  (data || []).reverse().forEach(addMsg);

  if (channel) sb.removeChannel(channel);
  channel = sb.channel("room")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => addMsg(p.new))
    .subscribe();
}

async function loadUsers() {
  const { data } = await sb.from("profiles").select("username").order("username");
  users = (data || []).map(u => u.username);
  $("count").textContent = users.length + (users.length === 1 ? " member" : " members");
}

/* ---------- RENDER ---------- */
function color(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return "hsl(" + h + ",50%,42%)";
}

function avatar(name, anonymous) {
  const a = document.createElement("div");
  a.className = "av";
  a.textContent = anonymous ? "?" : name[0].toUpperCase();
  a.style.background = anonymous ? "#444" : color(name);
  return a;
}

function rich(t) {
  const f = document.createDocumentFragment();
  t.split(/(@[a-z0-9_]+)/gi).forEach(s => {
    if (/^@[a-z0-9_]+$/i.test(s)) { const b = document.createElement("b"); b.textContent = s; f.append(b); }
    else f.append(document.createTextNode(s));
  });
  return f;
}

function addMsg(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  const mine = m.user_id === me.id;
  const who = m.anonymous ? "Anonymous" : m.username;
  const t = new Date(m.created_at).getTime();
  const l = $("list");
  const atBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 120;

  const gap = t - lastTime > 15 * 60000;
  if (gap) {
    const s = document.createElement("div");
    s.className = "stamp";
    s.textContent = new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    l.append(s);
  }
  const key = m.user_id + (m.anonymous ? ":a" : "");
  const first = gap || key !== lastKey;
  lastKey = key; lastTime = t;

  const row = document.createElement("div");
  row.className = "row" + (mine ? " me" : "") + (first ? " first" : "");
  if (!mine) {
    const av = avatar(who, m.anonymous);
    if (!first) av.classList.add("sp");
    row.append(av);
  }
  const col = document.createElement("div");
  col.className = "col";
  if (!mine && first) {
    const nm = document.createElement("div");
    nm.className = "nm"; nm.textContent = who;
    col.append(nm);
  }

  const bub = document.createElement("div");
  bub.className = "bub";
  const text = m.content || "";
  if (m.kind === "image") {
    bub.classList.add("media");
    const i = document.createElement("img");
    i.src = m.file_url; i.loading = "lazy";
    i.onclick = () => { $("lb").firstElementChild.src = m.file_url; $("lb").hidden = false; };
    bub.append(i);
  } else if (m.kind === "voice") {
    bub.classList.add("aud");
    const a = document.createElement("audio");
    a.controls = true; a.src = m.file_url;
    bub.append(a);
  } else if (m.kind === "file") {
    const a = document.createElement("a");
    a.href = m.file_url; a.target = "_blank";
    a.textContent = "File: " + (text || "download");
    bub.append(a);
  } else {
    if (!mine && new RegExp("@" + myName + "\\b", "i").test(text)) bub.classList.add("tag");
    bub.append(rich(text));
  }
  col.append(bub);
  row.append(col);
  l.append(row);
  if (atBottom || mine) l.scrollTop = l.scrollHeight;
  if (!m.anonymous && !users.includes(m.username)) loadUsers();
}

$("lb").onclick = () => { $("lb").hidden = true; };

/* ---------- SEND ---------- */
async function send(kind, content, file_url) {
  const { error } = await sb.from("messages").insert({
    user_id: me.id,
    username: anon ? "Anonymous" : myName,
    anonymous: anon,
    kind, content, file_url
  });
  if (error) alert(error.message);
}

function sync() {
  const t = $("txt");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
  $("field").classList.toggle("typing", t.value.trim().length > 0);
}

$("send").onclick = async () => {
  const t = $("txt").value.trim();
  if (!t) return;
  $("txt").value = "";
  $("picker").hidden = true;
  sync();
  await send("text", t, null);
};

$("txt").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 700) {
    e.preventDefault(); $("send").click();
  }
});

/* ---------- ANON ---------- */
function paintAnon() {
  $("anonBtn").textContent = "Anon: " + (anon ? "On" : "Off");
  $("anonBtn").classList.toggle("on", anon);
  $("txt").placeholder = anon ? "Message as Anonymous..." : "Message everyone...";
}
$("anonBtn").onclick = () => {
  anon = !anon; paintAnon();
  try { localStorage.setItem("op_anon", anon ? "1" : "0"); } catch (e) {}
};

/* ---------- TAG PICKER ---------- */
function showPicker(filter, force) {
  const box = $("picker");
  box.innerHTML = "";
  const f = (filter || "").toLowerCase();
  const list = users.filter(u => u !== myName && u.startsWith(f));
  if (!list.length && !force) { box.hidden = true; return; }
  const hd = document.createElement("div");
  hd.className = "hd";
  hd.textContent = list.length ? "Tag someone" : "No other members yet";
  box.append(hd);
  list.forEach(u => {
    const b = document.createElement("button");
    b.append(avatar(u, false));
    const s = document.createElement("span");
    s.textContent = "@" + u;
    b.append(s);
    b.onclick = () => insertTag(u);
    box.append(b);
  });
  box.hidden = false;
}

function insertTag(u) {
  const t = $("txt");
  let v = t.value;
  if (/@[a-z0-9_]*$/i.test(v)) v = v.replace(/@[a-z0-9_]*$/i, "@" + u + " ");
  else v += (v && !/\s$/.test(v) ? " " : "") + "@" + u + " ";
  t.value = v;
  $("picker").hidden = true;
  t.focus();
  sync();
}

$("at").onclick = () => {
  if (!$("picker").hidden) { $("picker").hidden = true; return; }
  const m = $("txt").value.match(/@([a-z0-9_]*)$/i);
  showPicker(m ? m[1] : "", true);
};

$("txt").addEventListener("input", () => {
  sync();
  const m = $("txt").value.match(/@([a-z0-9_]*)$/i);
  if (m) showPicker(m[1], false); else $("picker").hidden = true;
});

/* ---------- FILES / VOICE ---------- */
async function upload(blob, name, type) {
  const path = me.id + "/" + Date.now() + "-" + name.replace(/[^\w.\-]/g, "_");
  const { error } = await sb.storage.from("uploads").upload(path, blob, { contentType: type });
  if (error) throw error;
  return sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
}

$("clip").onclick = () => $("file").click();
$("file").onchange = async e => {
  for (const f of e.target.files) {
    try {
      const url = await upload(f, f.name, f.type || "application/octet-stream");
      await send(f.type.startsWith("image/") ? "image" : "file", f.name, url);
    } catch (err) { alert("Upload failed: " + err.message); }
  }
  e.target.value = "";
};

$("voiceFile").onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const url = await upload(f, f.name || "voice.m4a", f.type || "audio/mp4");
    await send("voice", "", url);
  } catch (err) { alert("Voice failed: " + err.message); }
  e.target.value = "";
};

$("mic").onclick = async () => {
  if (rec) { rec.stop(); return; }
  // In-app previews (Spck/WebView) can crash on mic access, so use the phone's own recorder there
  if (/; wv\)|Spck/i.test(navigator.userAgent) || !navigator.mediaDevices || !window.MediaRecorder) {
    $("voiceFile").click();
    return;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mt = ["audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    const r = new MediaRecorder(s, mt ? { mimeType: mt } : {});
    chunks = [];
    r.ondataavailable = e => chunks.push(e.data);
    r.onstop = async () => {
      s.getTracks().forEach(t => t.stop());
      const type = (r.mimeType || "audio/webm").split(";")[0];
      rec = null;
      $("mic").classList.remove("on");
      try {
        const url = await upload(new Blob(chunks, { type }), "voice." + (type.includes("mp4") ? "m4a" : "webm"), type);
        await send("voice", "", url);
      } catch (err) { alert("Voice failed: " + err.message); }
    };
    rec = r;
    r.start();
    $("mic").classList.add("on");
  } catch (err) { alert("Microphone blocked or unavailable"); }
};

start();
