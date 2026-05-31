// Design Library Unlocked - multi-site (Mobbin + Chamjo)
(() => {
	const TAG = "[Design Unlocked]";
	const HOST = location.hostname;
	const SITE = HOST.includes("chamjo") ? "chamjo" : HOST.includes("mobbin") ? "mobbin" : "generic";
	console.log(TAG, "loaded on", HOST, "→ site:", SITE);

	const stats = { scanned: 0, unlocked: 0, blurRemoved: 0, overlayRemoved: 0, paywallRemoved: 0 };
	const seenHosts = new Set();

	// --- Site-specific image upscaling rules ---------------------------------
	const SITE_RULES = {
		mobbin: {
			isCdn: (h) =>
				h.endsWith("mobbin.com") || h.includes("bytescale") || h.includes("upcdn.io"),
			isContent: (path) =>
				/(app_screens|web_screens|screens|flows|screenshots)/i.test(path),
			upscale: (url) => {
				const p = url.searchParams;
				p.set("f", "webp");
				p.set("w", "1920");
				p.set("q", "90");
				p.set("fit", "shrink-cover");
				return url.toString();
			},
		},
		chamjo: {
			isCdn: (h) =>
				h.endsWith("chamjo.design") ||
				h.includes("cloudinary") ||
				h.includes("imgix") ||
				h.includes("supabase") ||
				h.includes("cloudfront") ||
				h.includes("amazonaws") ||
				h.includes("vercel") ||
				h.includes("imagedelivery.net") ||
				h.includes("r2.dev"),
			isContent: () => true, // chamjo: try all images
			upscale: (url) => {
				const p = url.searchParams;
				// Strip common width-limiting params
				["w", "width", "h", "height", "q", "quality"].forEach((k) => {
					if (p.has(k)) {
						const v = parseInt(p.get(k), 10);
						if (k === "w" || k === "width") p.set(k, "1920");
						else if (k === "q" || k === "quality") p.set(k, "90");
						else if ((k === "h" || k === "height") && v < 1080) p.set(k, "1920");
					}
				});
				// Cloudinary-style path: /image/upload/w_400,q_60/...
				if (url.pathname.includes("/upload/")) {
					url.pathname = url.pathname.replace(
						/\/upload\/[^/]*\//,
						"/upload/w_1920,q_90,f_auto/",
					);
				}
				// Imgix-style
				if (url.hostname.includes("imgix")) {
					p.set("w", "1920");
					p.set("q", "90");
					p.set("auto", "format,compress");
				}
				return url.toString();
			},
		},
		generic: {
			isCdn: () => true,
			isContent: () => false,
			upscale: (url) => url.toString(),
		},
	};

	const rules = SITE_RULES[SITE];

	// --- 1. Image upscaling --------------------------------------------------
	const upscaleImage = (img) => {
		if (!img || img.dataset.dlUnlocked === "1") return;
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
			console.log(TAG, "img host:", url.hostname, url.pathname);
		}

		if (!rules.isCdn(url.hostname)) return;
		if (!rules.isContent(url.pathname)) return;

		stats.scanned++;
		const newSrc = rules.upscale(url);
		if (newSrc && newSrc !== rawSrc) {
			img.src = newSrc;
			img.removeAttribute("srcset");
			img.removeAttribute("loading");
			img.style.filter = "none";
			img.dataset.dlUnlocked = "1";
			stats.unlocked++;
		} else {
			img.dataset.dlUnlocked = "1";
		}

		// Walk parents: strip blur/overlay classes
		let p = img.parentElement;
		let depth = 0;
		while (p && depth < 6) {
			p.setAttribute("data-dl-cleaned", "1");
			if (typeof p.className === "string") {
				const cleaned = p.className
					.replace(/\bblur(-[\w-]+)?\b/g, "")
					.replace(/\bbackdrop-blur(-[\w-]+)?\b/g, "")
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

		// Remove sibling overlay divs (Mobbin-style: <div absolute inset-0 bg-... backdrop-blur>)
		const parent = img.parentElement;
		if (parent) {
			parent.querySelectorAll(":scope > div").forEach((sib) => {
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
					stats.overlayRemoved++;
				}
			});
		}
	};

	// --- 2. Strip computed blur ----------------------------------------------
	const stripBlurStyles = (root) => {
		if (!root.querySelectorAll) return;
		for (const el of root.querySelectorAll("*")) {
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

	// --- 3a. Chamjo-specific lock overlay removal ---------------------------
	const removeChamjoLocks = () => {
		if (SITE !== "chamjo") return;

		// Lock icon containers
		document
			.querySelectorAll(
				'[data-name="icon-Lock"], [data-testid="chamjo-icon"][data-name*="Lock" i]',
			)
			.forEach((el) => {
				// remove the wrapping overlay div (parent up to 2 levels)
				let target = el;
				for (let i = 0; i < 3 && target.parentElement; i++) {
					const p = target.parentElement;
					const cls = p.className || "";
					if (
						typeof cls === "string" &&
						/\babsolute\b/.test(cls) &&
						/(bottom-0|inset-0|top-0)/.test(cls)
					) {
						target = p;
					}
				}
				target.remove();
				stats.overlayRemoved++;
			});

		// Generic lock SVG (with that distinctive lock path)
		document.querySelectorAll("svg path").forEach((path) => {
			const d = path.getAttribute("d") || "";
			if (d.startsWith("M26 10H22V7C22 5.4087")) {
				const wrapper = path.closest('[class*="absolute"]') || path.closest("svg")?.parentElement;
				if (wrapper) {
					wrapper.remove();
					stats.overlayRemoved++;
				}
			}
		});

		// Solid color overlay divs over images (chamjo style: bg-[#5E636FE5])
		document.querySelectorAll('div[class*="bg-[#"]').forEach((el) => {
			const cls = el.className || "";
			if (typeof cls !== "string") return;
			if (
				/\babsolute\b/.test(cls) &&
				(/bottom-0/.test(cls) || /inset-0/.test(cls)) &&
				/bg-\[#[0-9A-Fa-f]{6,8}\]/.test(cls)
			) {
				el.remove();
				stats.overlayRemoved++;
			}
		});
	};

	// --- 3b. Paywall removal -------------------------------------------------
	const hidePaywall = () => {
		document.querySelectorAll("aside").forEach((el) => {
			if (/upgrade|pro|trial|unlock|paywall|sign up|sign in/i.test(el.textContent || "")) {
				const rect = el.getBoundingClientRect();
				// only remove if it looks like a side panel, not the main nav
				if (rect.width < window.innerWidth * 0.5) {
					el.remove();
					stats.paywallRemoved++;
				}
			}
		});
		document
			.querySelectorAll(
				'[data-sentry-component*="Paywall" i], [data-sentry-component*="Upgrade" i], [class*="paywall" i], [class*="Paywall" i], [class*="upsell" i]',
			)
			.forEach((el) => {
				el.remove();
				stats.paywallRemoved++;
			});
	};

	// --- 4. Inject CSS safety net --------------------------------------------
	const injectCss = () => {
		if (document.getElementById("dl-unlocked-style")) return;
		const style = document.createElement("style");
		style.id = "dl-unlocked-style";
		style.textContent = `
			img { filter: none !important; -webkit-filter: none !important; opacity: 1 !important; }
			[class*="blur"] img, [class*="Blur"] img { filter: none !important; }

			[data-dl-cleaned="1"]::after,
			[data-dl-cleaned="1"]::before {
				background: none !important;
				background-image: none !important;
				background-color: transparent !important;
				box-shadow: none !important;
				mix-blend-mode: normal !important;
				opacity: 0 !important;
			}

			div.absolute.inset-0[class*="backdrop-blur"],
			div.absolute.inset-0[class*="bg-[hsl"],
			div.absolute.inset-0[class*="bg-[rgb"] {
				display: none !important;
			}

			[data-sentry-component*="Paywall" i],
			[data-sentry-component*="Upgrade" i],
			[class*="paywall" i],
			[class*="Paywall" i],
			[class*="upsell" i] { display: none !important; }
		`;
		(document.head || document.documentElement).appendChild(style);
	};

	// --- 5. Master scan ------------------------------------------------------
	const scan = (root) => {
		const target = root && root.querySelectorAll ? root : document.body;
		if (!target) return;
		target.querySelectorAll("img").forEach(upscaleImage);
		scanBackgroundImages(target);
		stripBlurStyles(target);
		removeChamjoLocks();
		hidePaywall();
	};

	// Scan elements that use background-image CSS instead of <img>
	const bgHosts = new Set();
	const scanBackgroundImages = (root) => {
		if (!root.querySelectorAll) return;
		for (const el of root.querySelectorAll("[style*='background-image'], [style*='background:']")) {
			const bg = el.style.backgroundImage || "";
			const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
			if (!m) continue;
			try {
				const u = new URL(m[1], location.href);
				if (!bgHosts.has(u.hostname)) {
					bgHosts.add(u.hostname);
					console.log(TAG, "bg-image host:", u.hostname, u.pathname);
				}
			} catch {}
		}
		// Also check computed styles for elements that look like image slots
		for (const el of root.querySelectorAll("div,figure,section,article")) {
			const cs = getComputedStyle(el);
			if (cs.backgroundImage && cs.backgroundImage !== "none" && !el.dataset.dlBgChecked) {
				el.dataset.dlBgChecked = "1";
				const m = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
				if (m) {
					try {
						const u = new URL(m[1], location.href);
						if (!bgHosts.has(u.hostname)) {
							bgHosts.add(u.hostname);
							console.log(TAG, "bg-image host (computed):", u.hostname, u.pathname);
						}
					} catch {}
				}
			}
		}
	};

	// --- 6. MutationObserver -------------------------------------------------
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type === "childList") {
				m.addedNodes.forEach((n) => {
					if (n.nodeType === 1) {
						if (n.tagName === "IMG") upscaleImage(n);
						else scan(n);
					}
				});
			} else if (m.type === "attributes" && m.target.tagName === "IMG") {
				m.target.dataset.dlUnlocked = "";
				upscaleImage(m.target);
			}
		}
	});

	// --- 7. UI badge ---------------------------------------------------------
	let button;
	const makeButton = () => {
		button = document.createElement("button");
		button.id = "dl-unlocked-btn";
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
		button.innerHTML = `🔓 <span id="dl-count">0</span> · ${SITE}`;
		button.title = "Design Library Unlocked — click to rescan";
		button.onclick = () => {
			scan(document.body);
			console.log(TAG, "stats", stats, "hosts:", [...seenHosts]);
			refreshBadge();
		};
		document.body.appendChild(button);
	};

	const refreshBadge = () => {
		const el = button && button.querySelector("#dl-count");
		if (el) el.textContent = stats.unlocked;
	};

	// --- 8. Boot -------------------------------------------------------------
	const boot = () => {
		injectCss();
		if (!document.body) {
			requestAnimationFrame(boot);
			return;
		}
		scan(document.body);
		console.log(
			TAG,
			"boot scan done. <img> count:",
			document.querySelectorAll("img").length,
			"| hosts seen:",
			[...seenHosts],
			"| bg hosts:",
			[...bgHosts],
		);
		makeButton();
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "srcset", "class", "style"],
		});
		setInterval(refreshBadge, 800);
		[500, 1500, 3000, 6000].forEach((t) => setTimeout(() => scan(document.body), t));
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
})();
