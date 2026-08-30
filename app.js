const REPO_OWNER = window.location.hostname.split(".")[0];
const REPO_NAME = window.location.pathname.split("/").filter(Boolean)[0];
const FILTERS_PATH = "filters.json";

let pokemonKoNames = {};
let filters = [];
let editingIndex = null;
let selectedPokemon = null;
let currentMode = "stats";

// 초기화
async function init() {
  const patInput = document.getElementById("pat-input");
  const savedPat = localStorage.getItem("github_pat");
  if (savedPat) {
    patInput.value = savedPat;
  }

  const response = await fetch("pokemon_ko_names.json");
  pokemonKoNames = await response.json();

  await loadFilters();
  renderFilterCards();
}

// GitHub API 관련
function getPat() {
  return localStorage.getItem("github_pat");
}

function showStatus(message, isError) {
  const el = document.getElementById("status-msg");
  el.textContent = message;
  el.style.color = isError ? "#c0392b" : "#27ae60";
}

document.getElementById("pat-save-btn").addEventListener("click", () => {
  const value = document.getElementById("pat-input").value.trim();
  if (!value) {
    showStatus("토큰을 입력해주세요.", true);
    return;
  }
  localStorage.setItem("github_pat", value);
  showStatus("토큰이 저장되었습니다.", false);
});

async function githubApiRequest(path, options) {
  const pat = getPat();
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      ...(options && options.headers),
    },
  });
  return response;
}

async function loadFilters() {
  try {
    const response = await githubApiRequest(FILTERS_PATH, { method: "GET" });
    if (!response.ok) {
      filters = [];
      return;
    }
    const data = await response.json();
    const content = decodeURIComponent(escape(atob(data.content)));
    filters = JSON.parse(content);
  } catch (e) {
    filters = [];
  }
}

async function saveFiltersToGithub() {
  const pat = getPat();
  if (!pat) {
    showStatus("먼저 GitHub 토큰을 저장해주세요.", true);
    return;
  }

  let sha = null;
  const getResponse = await githubApiRequest(FILTERS_PATH, { method: "GET" });
  if (getResponse.ok) {
    const existing = await getResponse.json();
    sha = existing.sha;
  }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(filters, null, 2))));
  const putResponse = await githubApiRequest(FILTERS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "filters.json 갱신",
      content: content,
      sha: sha,
    }),
  });

  if (putResponse.ok) {
    showStatus("저장되었습니다.", false);
  } else {
    const errorData = await putResponse.json();
    showStatus(`저장 실패: ${errorData.message}`, true);
  }
}

// 포켓몬 검색
document.getElementById("pokemon-search").addEventListener("input", (e) => {
  const query = e.target.value.trim();
  const listEl = document.getElementById("pokemon-list");

  if (!query) {
    listEl.style.display = "none";
    listEl.innerHTML = "";
    return;
  }

  const matches = Object.entries(pokemonKoNames)
    .filter(([identifier, info]) => info.ko.includes(query) || identifier.includes(query.toLowerCase()))
    .slice(0, 30);

  if (matches.length === 0) {
    listEl.style.display = "none";
    return;
  }

  listEl.innerHTML = "";
  matches.forEach(([identifier, info]) => {
    const item = document.createElement("div");
    item.textContent = `${info.ko} (#${info.id})`;
    item.addEventListener("click", () => {
      selectedPokemon = { identifier, id: info.id, ko: info.ko };
      document.getElementById("selected-pokemon").textContent = `선택됨: ${info.ko}`;
      listEl.style.display = "none";
      document.getElementById("pokemon-search").value = "";
    });
    listEl.appendChild(item);
  });
  listEl.style.display = "block";
});

// 위치 정보
document.getElementById("geolocate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("이 브라우저는 위치 정보를 지원하지 않습니다.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      document.getElementById("coords-input").value = `${lat},${lng}`;
    },
    () => {
      showStatus("위치 정보를 가져올 수 없습니다.", true);
    }
  );
});

// Stats/PvP 탭 전환
document.getElementById("tab-stats").addEventListener("click", () => {
  currentMode = "stats";
  document.getElementById("tab-stats").classList.add("active");
  document.getElementById("tab-pvp").classList.remove("active");
  document.getElementById("stats-fields").classList.remove("hidden");
  document.getElementById("pvp-fields").classList.add("hidden");
});

document.getElementById("tab-pvp").addEventListener("click", () => {
  currentMode = "pvp";
  document.getElementById("tab-pvp").classList.add("active");
  document.getElementById("tab-stats").classList.remove("active");
  document.getElementById("pvp-fields").classList.remove("hidden");
  document.getElementById("stats-fields").classList.add("hidden");
});

// 조건 카드 렌더링
function renderFilterCards() {
  const container = document.getElementById("filter-cards");
  container.innerHTML = "";

  if (filters.length === 0) {
    container.innerHTML = "<p style='color:#888; font-size:14px'>등록된 조건이 없습니다.</p>";
    return;
  }

  filters.forEach((filter, index) => {
    const card = document.createElement("div");
    card.className = "card";

    const pokemonLabel = filter.pokemon_ids.length > 0
      ? (pokemonKoNames[filter._pokemon_identifier] ? pokemonKoNames[filter._pokemon_identifier].ko : filter._pokemon_identifier)
      : "전체 포켓몬";

    const modeLabel = filter.pvp_mode ? "PvP 기준" : "스탯 기준";

    card.innerHTML = `
      <div class="card-header">
        <div>
          <strong>${pokemonLabel}</strong> (${modeLabel})<br>
          <span style="font-size:13px; color:#666">반경 ${filter.radius_km}km</span>
        </div>
        <div class="card-actions">
          <button class="secondary" data-edit="${index}">수정</button>
          <button class="danger" data-delete="${index}">삭제</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditForm(parseInt(btn.dataset.edit)));
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      filters.splice(parseInt(btn.dataset.delete), 1);
      await saveFiltersToGithub();
      renderFilterCards();
    });
  });
}

// 폼 열기/닫기
document.getElementById("add-filter-btn").addEventListener("click", () => {
  openNewForm();
});

document.getElementById("cancel-btn").addEventListener("click", () => {
  document.getElementById("filter-form-card").classList.add("hidden");
});

function resetForm() {
  selectedPokemon = null;
  document.getElementById("selected-pokemon").textContent = "";
  document.getElementById("pokemon-search").value = "";
  document.getElementById("coords-input").value = "";
  document.getElementById("radius-input").value = "";
  document.getElementById("cp-min").value = "";
  document.getElementById("cp-max").value = "";
  document.getElementById("level-min").value = "";
  document.getElementById("level-max").value = "";
  document.getElementById("iv-min").value = "";
  document.getElementById("iv-max").value = "";
  document.getElementById("size-select").value = "";
  document.getElementById("form-input").value = "";
  document.getElementById("gender-select").value = "";
  document.getElementById("pvp-league").value = "great";
  document.getElementById("pvp-top-rank").value = "";
  document.getElementById("pvp-include-pre").value = "yes";
  document.getElementById("pvp-min-cp").value = "";
  document.getElementById("pvp-size-select").value = "";
  document.getElementById("pvp-form-input").value = "";
  document.getElementById("pvp-gender-select").value = "";
}

function openNewForm() {
  editingIndex = null;
  resetForm();
  document.getElementById("form-title").textContent = "새 조건";
  document.getElementById("filter-form-card").classList.remove("hidden");
}

function openEditForm(index) {
  editingIndex = index;
  resetForm();
  const filter = filters[index];

  if (filter._pokemon_identifier && pokemonKoNames[filter._pokemon_identifier]) {
    selectedPokemon = {
      identifier: filter._pokemon_identifier,
      id: pokemonKoNames[filter._pokemon_identifier].id,
      ko: pokemonKoNames[filter._pokemon_identifier].ko,
    };
    document.getElementById("selected-pokemon").textContent = `선택됨: ${selectedPokemon.ko}`;
  }

  document.getElementById("coords-input").value = `${filter.center_lat},${filter.center_lng}`;
  document.getElementById("radius-input").value = filter.radius_km;

  if (filter.pvp_mode) {
    document.getElementById("tab-pvp").click();
    document.getElementById("pvp-league").value = filter.pvp_league || "great";
    document.getElementById("pvp-top-rank").value = filter.pvp_top_rank || "";
    document.getElementById("pvp-include-pre").value = filter.pvp_include_pre_evolutions ? "yes" : "no";
    document.getElementById("pvp-min-cp").value = filter.pvp_min_cp || "";
    document.getElementById("pvp-size-select").value = (filter.sizes && filter.sizes[0]) || "";
    document.getElementById("pvp-form-input").value = (filter.forms && filter.forms[0]) || "";
    document.getElementById("pvp-gender-select").value = filter.gender || "";
  } else {
    document.getElementById("tab-stats").click();
    document.getElementById("cp-min").value = filter.cp_min ?? "";
    document.getElementById("cp-max").value = filter.cp_max ?? "";
    document.getElementById("level-min").value = filter.level_min ?? "";
    document.getElementById("level-max").value = filter.level_max ?? "";
    document.getElementById("iv-min").value = filter.iv_percent_min ?? "";
    document.getElementById("iv-max").value = filter.iv_percent_max ?? "";
    document.getElementById("size-select").value = (filter.sizes && filter.sizes[0]) || "";
    document.getElementById("form-input").value = (filter.forms && filter.forms[0]) || "";
    document.getElementById("gender-select").value = filter.gender || "";
  }

  document.getElementById("form-title").textContent = "조건 수정";
  document.getElementById("filter-form-card").classList.remove("hidden");
}

// 저장
document.getElementById("save-filter-btn").addEventListener("click", async () => {
  const coordsRaw = document.getElementById("coords-input").value.trim();
  const radiusRaw = document.getElementById("radius-input").value.trim();

  if (!coordsRaw || !radiusRaw) {
    showStatus("좌표와 반경은 필수입니다.", true);
    return;
  }

  const coordsParts = coordsRaw.split(",").map((s) => parseFloat(s.trim()));
  if (coordsParts.length !== 2 || coordsParts.some(isNaN)) {
    showStatus("좌표 형식이 올바르지 않습니다. (예: 37.5665,126.9780)", true);
    return;
  }

  const isPvp = currentMode === "pvp";

  const newFilter = {
    pvp_mode: isPvp,
    pvp_league: isPvp ? document.getElementById("pvp-league").value : "great",
    pvp_top_rank: isPvp ? (parseInt(document.getElementById("pvp-top-rank").value) || null) : null,
    pvp_include_pre_evolutions: isPvp ? document.getElementById("pvp-include-pre").value === "yes" : true,
    blacklist_forms: [],
    blacklist_pokemon_ids: [],
    blacklist_species_forms: [],
    boosted: null,
    center_lat: coordsParts[0],
    center_lng: coordsParts[1],
    cp_max: !isPvp ? (parseInt(document.getElementById("cp-max").value) || null) : null,
    cp_min: !isPvp ? (parseInt(document.getElementById("cp-min").value) || null) : null,
    forms: [],
    gender: isPvp ? (document.getElementById("pvp-gender-select").value || null) : (document.getElementById("gender-select").value || null),
    iv_mode: "percent",
    iv_percent_max: !isPvp ? (parseFloat(document.getElementById("iv-max").value) || null) : null,
    iv_percent_min: !isPvp ? (parseFloat(document.getElementById("iv-min").value) || null) : null,
    level_max: !isPvp ? (parseFloat(document.getElementById("level-max").value) || null) : null,
    level_min: !isPvp ? (parseFloat(document.getElementById("level-min").value) || null) : null,
    location: null,
    min_ttl: null,
    pokemon_ids: selectedPokemon ? [selectedPokemon.id] : [],
    pvp_min_cp: isPvp ? (parseInt(document.getElementById("pvp-min-cp").value) || null) : null,
    radius_km: parseFloat(radiusRaw),
    raw_iv_atk: null,
    raw_iv_def: null,
    raw_iv_sta: null,
    sizes: (() => {
      const sizeValue = isPvp ? document.getElementById("pvp-size-select").value : document.getElementById("size-select").value;
      return sizeValue ? [sizeValue] : [];
    })(),
    sort: "DISTANCE",
    species_forms: [],
    weather_id: null,
    _pokemon_identifier: selectedPokemon ? selectedPokemon.identifier : null,
  };

  const formValue = isPvp ? document.getElementById("pvp-form-input").value.trim() : document.getElementById("form-input").value.trim();
  if (formValue) {
    newFilter.forms = [formValue];
  }

  if (editingIndex !== null) {
    filters[editingIndex] = newFilter;
  } else {
    filters.push(newFilter);
  }

  await saveFiltersToGithub();
  document.getElementById("filter-form-card").classList.add("hidden");
  renderFilterCards();
});

init();
