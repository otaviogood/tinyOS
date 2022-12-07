import { elasticOut, cubicOut } from "svelte/easing";

export function scaleDown(node, { duration }) {
    return {
        duration,
        css: (t) => {
            const eased = elasticOut(t);

            return `
					transform: scale(${8.0 - t * 7}) rotate(${4.0 - eased * 4}rad);
                    opacity: ${t};
					`;
        },
    };
}

export function slideLeft(node, { delay, duration }) {
    return {
        delay,
        duration,
        css: (t) => {
            const eased = elasticOut(t);

            return `
					transform: translate(${-t * 35}rem, 0);
					`;
        },
    };
}

export function pulseShadow(node, { duration }) {
    return {
        duration,
        css: (t) => {
            return `
                    /* in order: x offset, y offset, blur size, spread size, color */
                    box-shadow: 0px 0px 4rem 3rem rgb(0,255,255,${1.0 - t});
  					`;
        },
    };
}

export function spin(node, { duration }) {
    return {
        duration,
        css: (t) => {
            const eased = elasticOut(t);

            return `
					transform: scale(${eased}) rotate(${eased * 1080}deg);
					color: hsl(
						${~~(t * 360)},
						${Math.min(100, 1000 - 1000 * t)}%,
						${Math.min(50, 500 - 500 * t)}%
					);`;
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
					transform: scale(${1.0 + Math.sin(eased * Math.PI) * 0.2});
                    will-change: transform;
					`;
        },
    };
}

