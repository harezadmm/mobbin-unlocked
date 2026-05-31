// Mobbin Unlocked - robust auto version
(() => {
	const TAG = "[Mobbin Unlocked]";
	console.log(TAG, "loaded on", location.href);

	const stats = { scanned: 0, unlocked: 0, blurRemoved: 0, paywallRemoved: 0 };
	const seenHosts = new Set();

	// --- 1. Image upscaling -------------------------------------------------
	const upscaleImage = (img) => {
		if (!img || img.dataset.mobbinUnlocked === "1") return;
		const rawSrc = img.currentSrc || img.src;
		if (!rawSrc || rawSrc.startsWith("data:")) return;

		let url;
		try {
			url = new URL(rawSrc, location.href);
		} catch {
			return;
		}

		if (!seenHosts.has(url.hostname)) {
			seenHosts.add(url.hostname);
			console.debug(TAG, "image host seen:", url.hostname, url.pathname);
		}

		const host = url.hostname;
		const isMobbinCdn =
			host.endsWith("mobbin.com") ||
			host.includes("bytescale") ||
			host.includes("upcdn.io");
		if (!isMobbinCdn) return;

		const path = url.pathname.toLowerCase();
		const isContentImg =
			path.includes("app_screens") ||
			path.includes("screens") ||
			path.includes("flows") ||
			path.includes("web_screens") ||
			path.includes("screenshots");
		if (!isContentImg) return;

		stats.scanned++;

		// Bytescale-style transform params
		const params = url.searchParams;
		params.set("f", "webp");
		params.set("w", "1920");
		params.set("q", "90");
		params.set("fit", "shrink-cover");

		const newSrc = url.toString();
		if (newSrc !== rawSrc) {
			img.src = newSrc;
			img.removeAttribute("srcset");
			img.removeAttribute("loading");
			img.style.filter = "none";
			img.dataset.mobbinUnlocked = "1";
			stats.unlocked++;
		}

		// Remove sibling overlay divs that sit on top of the image
		// (Mobbin uses: <div class="absolute inset-0 bg-[hsl(...)] backdrop-blur-[10px]">)
		const parent = img.parentElement;
		if (parent) {
			parent.querySelectorAll(":scope > div").forEach((sib) => {
				if (sib === img) return;
				const cls = sib.className || "";
				if (typeof cls !== "string") return;
				const isOverlay =
					/\babsolute\b/.test(cls) &&
					/\binset-0\b/.test(cls) &&
					(/backdrop-blur/.test(cls) ||
						/\bbg-\[/.test(cls) ||
						/\bbg-(white|black|neutral)/.test(cls));
				if (isOverlay) {
					sib.remove();
					stats.blurRemoved++;
				}
			});
		}

		// Walk parents: strip blur classes + nuke "after:bg-*" tint overlays
		let p = img.parentElement;
		let depth = 0;
		while (p && depth < 6) {
			p.setAttribute("data-mobbin-cleaned", "1");
			if (p.className && typeof p.className === "string") {
				const cleaned = p.className
					.replace(/\bblur(-[\w-]+)?\b/g, "")
					.replace(/\bbackdrop-blur(-[\w-]+)?\b/g, "")
					// Tailwind after:/before: tint utilities
					.replace(/\b(after|before):bg-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):from-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):to-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):via-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):bg-gradient[\w-]*/g, "")
					.replace(/\b(after|before):backdrop-[\w-]+/g, "")
					.replace(/\b(after|before):mix-blend-[\w-]+/g, "")
					.replace(/\b(after|before):opacity-[\w/\[\].]+/g, "");
				if (cleaned !== p.className) {
					p.className = cleaned;
					stats.blurRemoved++;
				}
			}
			if (p.style) {
				if (p.style.filter && p.style.filter.includes("blur")) p.style.filter = "none";
				if (p.style.backdropFilter) p.style.backdropFilter = "none";
			}
			p = p.parentElement;
			depth++;
		}
	};

	// --- 2. Remove blur via computed CSS ------------------------------------
	const stripBlurStyles = (root) => {
		const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
		for (const el of all) {
			const cs = getComputedStyle(el);
			if (cs.filter && cs.filter.includes("blur")) {
				el.style.setProperty("filter", "none", "important");
				stats.blurRemoved++;
			}
			if (cs.backdropFilter && cs.backdropFilter.includes("blur")) {
				el.style.setProperty("backdrop-filter", "none", "important");
			}
		}
	};

	// Inject a global CSS override to kill all blur effects on screens
	const injectCss = () => {
		if (document.getElementById("mobbin-unlocked-style")) return;
		const style = document.createElement("style");
		style.id = "mobbin-unlocked-style";
		style.textContent = `
			img { filter: none !important; -webkit-filter: none !important; opacity: 1 !important; }
			[class*="blur"] img, [class*="Blur"] img { filter: none !important; }

			/* Kill tint overlay only on containers that wrap a screenshot image */
			[data-mobbin-cleaned="1"]::after,
			[data-mobbin-cleaned="1"]::before {
				background: none !important;
				background-image: none !important;
				background-color: transparent !important;
				box-shadow: none !important;
				mix-blend-mode: normal !important;
				opacity: 0 !important;
			}

			/* Mobbin's blur overlay div sibling of <img> */
			div.absolute.inset-0[class*="backdrop-blur"],
			div.absolute.inset-0[class*="bg-[hsl"] {
				display: none !important;
			}

			/* Paywall containers */
			[data-sentry-component*="Paywall" i],
			[data-sentry-component*="Upgrade" i],
			[class*="paywall" i],
			[class*="Paywall" i] { display: none !important; }
		`;
		(document.head || document.documentElement).appendChild(style);
	};

	// --- 3. Hide paywall / upsell -------------------------------------------
	const hidePaywall = () => {
		document.querySelectorAll("aside").forEach((el) => {
			// Mobbin's free-trial / upgrade aside
			if (/upgrade|pro|trial|unlock|paywall/i.test(el.textContent || "")) {
				el.remove();
				stats.paywallRemoved++;
			}
		});
		document
			.querySelectorAll(
				'[data-sentry-component*="Paywall" i], [data-sentry-component*="Upgrade" i], [class*="paywall" i]',
			)
			.forEach((el) => {
				el.remove();
				stats.paywallRemoved++;
			});
	};

	// --- 4. Master scan -----------------------------------------------------
	const scan = (root) => {
		const target = root && root.querySelectorAll ? root : document.body;
		if (!target) return;
		target.querySelectorAll("img").forEach(upscaleImage);
		stripBlurStyles(target);
		hidePaywall();
	};

	// --- 5. Observe SPA mutations -------------------------------------------
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type === "childList") {
				m.addedNodes.forEach((n) => {
					if (n.nodeType === 1) {
						if (n.tagName === "IMG") upscaleImage(n);
						else scan(n);
					}
				});
			} else if (m.type === "attributes") {
				if (m.target.tagName === "IMG") {
					m.target.dataset.mobbinUnlocked = "";
					upscaleImage(m.target);
				}
			}
		}
	});

	// --- 6. UI badge --------------------------------------------------------
	let button;
	const makeButton = () => {
		button = document.createElement("button");
		button.id = "mobbin-unlocked-btn";
		button.style.cssText = [
			"position:fixed",
			"left:20px",
			"bottom:20px",
			"z-index:2147483647",
			"display:flex",
			"align-items:center",
			"gap:8px",
			"padding:10px 14px",
			"border-radius:22px",
			"background:#111",
			"color:#fff",
			"border:1px solid #444",
			"font:13px system-ui,sans-serif",
			"cursor:pointer",
			"box-shadow:0 4px 14px rgba(0,0,0,.5)",
		].join(";");
		button.innerHTML = `🔓 <span id="mu-count">0</span>`;
		button.title = "Mobbin Unlocked — click to rescan";
		button.onclick = () => {
			scan(document.body);
			console.log(TAG, "stats", stats, "hosts:", [...seenHosts]);
			refreshBadge();
		};
		document.body.appendChild(button);
	};

	const refreshBadge = () => {
		const el = button && button.querySelector("#mu-count");
		if (el) el.textContent = stats.unlocked;
	};

	// --- 7. Boot ------------------------------------------------------------
	const boot = () => {
		injectCss();
		if (!document.body) {
			requestAnimationFrame(boot);
			return;
		}
		scan(document.body);
		makeButton();
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "srcset", "class", "style"],
		});
		setInterval(refreshBadge, 800);
		// extra delayed scans for late-hydrating Next.js content
		[500, 1500, 3000, 6000].forEach((t) => setTimeout(() => scan(document.body), t));
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
})();
