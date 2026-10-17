const markets=[
 ["Volatility 100 Index","5772.41","+0.62%","upv"],["Volatility 75 Index","339.52","+0.48%","upv"],
 ["Volatility 10 Index","7356.20","+0.31%","upv"],["Boom 500 Index","487.36","+0.74%","upv"],
 ["Crash 500 Index","522.41","-0.53%","dnv"],["EUR/USD","1.0684","+0.12%","upv"],
 ["GBP/USD","1.2523","+0.21%","upv"],["USD/JPY","149.82","-0.08%","dnv"],["Gold","2,659.48","+0.36%","upv"],["Silver","31.24","+0.42%","upv"]
];
const list=document.getElementById("marketList");
function renderMarkets(q=""){list.innerHTML=markets.filter(m=>m[0].toLowerCase().includes(q.toLowerCase())).map(m=>`<div class="market"><div><b>${m[0]}</b><small>${m[1]}</small></div><span class="${m[3]}">${m[2]}</span></div>`).join("")}
renderMarkets();
document.getElementById("marketSearch").addEventListener("input",e=>renderMarkets(e.target.value));
const toastEl=document.getElementById("toast");
function toast(msg){toastEl.textContent=msg;toastEl.classList.add("show");setTimeout(()=>toastEl.classList.remove("show"),2200)}
document.getElementById("connectBtn").onclick=()=>{window.location.href="https://tradezora-backend-use-1.onrender.com/auth/login";};
document.getElementById("realBtn").onclick=()=>toast("Real trading requires an authenticated Deriv account and explicit confirmation.");
document.getElementById("createBtn").onclick=()=>toast("Strategy builder coming next.");
document.getElementById("stopAll").onclick=()=>{document.getElementById("bot").checked=false;toast("All automation stopped.");};
document.getElementById("stopBtn").onclick=()=>{document.getElementById("bot").checked=false;toast("Strategy stopped.");};
document.getElementById("pauseBtn").onclick=()=>toast("Strategy paused.");
document.getElementById("bot").onchange=e=>toast(e.target.checked?"Demo automation started.":"Demo automation stopped.");
function trade(direction){
 const stake=Math.max(0,parseFloat(document.getElementById("stake").value)||1);
 const payout=stake*1.9;
 document.getElementById("payout").textContent="$"+payout.toFixed(2);
 document.getElementById("openPnl").textContent="$0.00";
 toast(`Demo ${direction} trade placed — $${stake.toFixed(2)}`);
}
document.getElementById("upBtn").onclick=()=>trade("UP");
document.getElementById("downBtn").onclick=()=>trade("DOWN");
document.getElementById("stake").addEventListener("input",e=>{const v=parseFloat(e.target.value)||0;document.getElementById("payout").textContent="$"+(v*1.9).toFixed(2)});
