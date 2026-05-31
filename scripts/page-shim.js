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

	const _push = history.pushState;
	const _replace = history.replaceState;
	history.pushState = function (state, title, url) {
		if (isBrowseRoot(url) && isDetailPath(location.pathname)) {
			console.log(TAG, "blocked pushState ->", url);
			return;
		}
		return _push.apply(this, arguments);
	};
	history.replaceState = function (state, title, url) {
		if (isBrowseRoot(url) && isDetailPath(location.pathname)) {
			console.log(TAG, "blocked replaceState ->", url);
			return;
		}
		return _replace.apply(this, arguments);
	};

	try {
		const _assign = window.location.assign.bind(window.location);
		const _locReplace = window.location.replace.bind(window.location);
		window.location.assign = function (url) {
			if (isBrowseRoot(url) && isDetailPath(window.location.pathname)) {
				console.log(TAG, "blocked location.assign ->", url);
				return;
			}
			return _assign(url);
		};
		window.location.replace = function (url) {
			if (isBrowseRoot(url) && isDetailPath(window.location.pathname)) {
				console.log(TAG, "blocked location.replace ->", url);
				return;
			}
			return _locReplace(url);
		};
	} catch (e) {
		console.warn(TAG, "couldn't patch location:", e);
	}

	// Also block popstate-driven redirects: if URL becomes /browse while we
	// expected to be on detail page, push it back.
	let lastDetail = isDetailPath(location.pathname) ? location.pathname : null;
	setInterval(() => {
		if (isDetailPath(location.pathname)) {
			lastDetail = location.pathname;
		} else if (lastDetail && location.pathname === "/browse") {
			console.log(TAG, "URL slipped to /browse, restoring", lastDetail);
			history.replaceState({}, "", lastDetail);
		}
	}, 200);

	console.log(TAG, "router redirect shim installed");
})();
