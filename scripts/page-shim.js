// Page-context shim for Chamjo - runs in MAIN world
// Blocks paywall redirects from /browse/Name/123 back to /browse
(() => {
	if (!location.hostname.includes("chamjo")) return;
	const TAG = "[Design Unlocked:main]";

	const isDetailPath = (p) => /^\/browse\/[^/]+\/\d+$/.test(p || "");
	const isBrowseRoot = (u) => {
		try {
			const s = typeof u === "string" ? u : (u && u.toString()) || "";
			if (!s) return false;
			const p = s.startsWith("http") ? new URL(s).pathname : s.split("?")[0].split("#")[0];
			return p === "/browse" || p === "/browse/";
		} catch {
			return false;
		}
	};

	const shouldBlock = (url) => isBrowseRoot(url) && isDetailPath(location.pathname);

	// --- 1. Patch history methods --------------------------------------------
	const _push = history.pushState;
	const _replace = history.replaceState;
	history.pushState = function (state, title, url) {
		if (shouldBlock(url)) {
			console.log(TAG, "blocked pushState ->", url);
			return;
		}
		return _push.apply(this, arguments);
	};
	history.replaceState = function (state, title, url) {
		if (shouldBlock(url)) {
			console.log(TAG, "blocked replaceState ->", url);
			return;
		}
		return _replace.apply(this, arguments);
	};

	// --- 2. Patch Location prototype setters ---------------------------------
	// (location.href = '/browse' / location.pathname = '/browse' / etc.)
	try {
		const LocProto = Object.getPrototypeOf(window.location) || Location.prototype;
		const wrapSetter = (propName) => {
			const desc =
				Object.getOwnPropertyDescriptor(LocProto, propName) ||
				Object.getOwnPropertyDescriptor(Location.prototype, propName);
			if (!desc || !desc.set) return false;
			const origSet = desc.set;
			const origGet = desc.get;
			try {
				Object.defineProperty(LocProto, propName, {
					configurable: true,
					enumerable: desc.enumerable,
					get: origGet,
					set: function (val) {
						if (shouldBlock(val) || (propName === "pathname" && shouldBlock(val))) {
							console.log(TAG, `blocked location.${propName} ->`, val);
							return;
						}
						return origSet.call(this, val);
					},
				});
				return true;
			} catch (e) {
				console.warn(TAG, `can't patch location.${propName}:`, e.message);
				return false;
			}
		};
		["href", "pathname", "search", "hash"].forEach(wrapSetter);
	} catch (e) {
		console.warn(TAG, "Location proto patch failed:", e);
	}

	// --- 3. Patch location.assign / location.replace -------------------------
	try {
		const _assign = window.location.assign.bind(window.location);
		const _locReplace = window.location.replace.bind(window.location);
		window.location.assign = function (url) {
			if (shouldBlock(url)) {
				console.log(TAG, "blocked location.assign ->", url);
				return;
			}
			return _assign(url);
		};
		window.location.replace = function (url) {
			if (shouldBlock(url)) {
				console.log(TAG, "blocked location.replace ->", url);
				return;
			}
			return _locReplace(url);
		};
	} catch (e) {
		console.warn(TAG, "couldn't patch location methods:", e);
	}

	// --- 3b. Block anchor clicks + form submits going to /browse from detail
	document.addEventListener(
		"click",
		(e) => {
			if (!isDetailPath(location.pathname)) return;
			const a = e.target && e.target.closest && e.target.closest("a[href]");
			if (a && shouldBlock(a.getAttribute("href")) || (a && shouldBlock(a.href))) {
				console.log(TAG, "blocked anchor click ->", a.href);
				e.preventDefault();
				e.stopPropagation();
				if (e.stopImmediatePropagation) e.stopImmediatePropagation();
			}
		},
		true,
	);
	document.addEventListener(
		"submit",
		(e) => {
			const f = e.target;
			if (!f) return;
			const action = f.action || "";
			if (shouldBlock(action) && isDetailPath(location.pathname)) {
				console.log(TAG, "blocked form submit ->", action);
				e.preventDefault();
				e.stopPropagation();
				if (e.stopImmediatePropagation) e.stopImmediatePropagation();
			}
		},
		true,
	);

	// --- 3c. Patch window.open just in case ---------------------------------
	const _open = window.open;
	window.open = function (url) {
		if (shouldBlock(url)) {
			console.log(TAG, "blocked window.open ->", url);
			return null;
		}
		return _open.apply(this, arguments);
	};

	// --- 4. Watch <meta http-equiv="refresh"> and remove -------------------
	const stripMetaRefresh = () => {
		document
			.querySelectorAll('meta[http-equiv="refresh" i], meta[http-equiv="Refresh" i]')
			.forEach((m) => {
				console.log(TAG, "removed meta refresh:", m.content);
				m.remove();
			});
	};

	// --- 5. SessionStorage fallback for hard reloads -----------------------
	const SS_KEY = "dl_last_detail";
	const recordDetail = () => {
		if (isDetailPath(location.pathname)) {
			sessionStorage.setItem(SS_KEY, location.pathname);
		}
	};
	const restoreFromStorage = () => {
		const stored = sessionStorage.getItem(SS_KEY);
		if (!stored) return;
		// If we're on /browse but were just on a detail page, restore
		if (location.pathname === "/browse" && stored && stored !== "/browse") {
			console.log(TAG, "hard-reload restore to", stored);
			sessionStorage.removeItem(SS_KEY); // clear to avoid loops
			history.replaceState({}, "", stored);
			// trigger Next.js to re-render
			window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
		}
	};

	// On initial load: record if on detail, OR restore if on /browse
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			stripMetaRefresh();
			restoreFromStorage();
			recordDetail();
		});
	} else {
		stripMetaRefresh();
		restoreFromStorage();
		recordDetail();
	}

	// --- 6. Interval guard: detect URL slip and restore --------------------
	let lastDetail = isDetailPath(location.pathname) ? location.pathname : null;
	let slipRestoreCount = 0;
	setInterval(() => {
		if (isDetailPath(location.pathname)) {
			lastDetail = location.pathname;
			sessionStorage.setItem(SS_KEY, location.pathname);
			slipRestoreCount = 0;
		} else if (lastDetail && location.pathname === "/browse" && slipRestoreCount < 20) {
			slipRestoreCount++;
			console.log(TAG, "URL slipped to /browse, restoring", lastDetail);
			_replace.call(history, {}, "", lastDetail);
			window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
		}
	}, 30);

	console.log(TAG, "router redirect shim installed");
})();
