(function () {
  "use strict";

  var DB_NAME = "krwo-offline-read-model";
  var STORE_NAME = "snapshots";
  var SNAPSHOT_KEY = "pulse-public";

  if (!("indexedDB" in window)) return;

  var request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = function () {
    var database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = function () {
    var database = request.result;
    var transaction = database.transaction(STORE_NAME, "readonly");
    var read = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    read.onsuccess = function () {
      renderSnapshot(read.result);
      database.close();
    };
    read.onerror = function () {
      database.close();
    };
  };

  function renderSnapshot(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.items)) {
      return;
    }

    var items = snapshot.items.slice(0, 6);
    if (items.length === 0) return;

    var section = document.getElementById("saved-filings");
    var list = document.getElementById("saved-filing-list");
    var synchronizedAt = document.getElementById("saved-filings-time");
    if (!section || !list || !synchronizedAt) return;

    var formattedTime = formatDate(snapshot.synchronized_at);
    synchronizedAt.textContent = formattedTime
      ? "마지막 동기화: " + formattedTime
      : "마지막 동기화 시각을 확인할 수 없습니다.";

    items.forEach(function (item) {
      var row = document.createElement("li");
      var meta = document.createElement("p");
      var title = document.createElement("h2");
      var body = document.createElement("p");

      meta.className = "saved-meta";
      meta.textContent = [item.ticker, item.eyebrow].filter(Boolean).join(" · ");
      title.textContent = String(item.title || "공시 업데이트");
      body.className = "saved-body";
      body.textContent = String(item.body || "");

      row.appendChild(meta);
      row.appendChild(title);
      if (body.textContent) row.appendChild(body);
      list.appendChild(row);
    });

    section.hidden = false;
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return date.toLocaleString("ko-KR");
    }
  }
})();
