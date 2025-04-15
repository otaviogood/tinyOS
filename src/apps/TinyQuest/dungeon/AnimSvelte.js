import { elasticOut, cubicInOut, cubicOut } from "svelte/easing";

export function shake(node, { delay, duration, flip = 1 }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = cubicOut(t);

            return `
                    transform: scale(${(1.0 + Math.sin(eased * Math.PI) * 0.05) * flip}, ${
                1.0 + Math.sin(eased * Math.PI) * 0.05
            }) rotate(${Math.sin(eased * Math.PI * 3) * 0.2}rad);
                    will-change: transform;
                    filter: drop-shadow(0 0 ${4.75 * (1.0 - eased)}rem #ff3020);
                    `;
        },
    };
}

export function shakeIce(node, { delay, duration, flip = 1 }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = cubicOut(t);

            return `
                    transform: scale(${(1.0 + Math.sin(eased * Math.PI) * 0.05) * flip}, ${
                1.0 + Math.sin(eased * Math.PI) * 0.05
            }) translate(${Math.sin(eased * Math.PI * 3) * 0.2}rem, ${Math.sin(eased * Math.PI * 3) * 0.2}rem);
                    will-change: transform;
                    `;
        },
    };
}

export function slideHit(node, { delay, duration, dir=1 }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = cubicOut(t);

            return `
                    transform: translate(${Math.sin(eased * Math.PI) * 16.0 * dir}rem, var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
                    will-change: transform;
                    `;
        },
    };
}

export function scalePulse(node, { delay, duration }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = cubicOut(t);

            return `
                    transform: scale(1.0, ${1.0 + Math.sin(eased * Math.PI) * 0.8});
                    will-change: transform;
                    `;
        },
    };
}

export function scalePulse2(node, { delay, duration }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = cubicOut(t);

            return `
                    transform: scale(1.0, ${1.0 + Math.sin(eased * Math.PI) * 0.2});
                    will-change: transform;
                    `;
        },
    };
}
