<script>
    export let style = "";
    let clazz = "";
    export { clazz as class };

    export let color = "#2aaa82";
    export let radius = 80;
    export let startAngle = -120;
    export let endAngle = 120;
    export let thick = 3;

    const angleInRadians = (angleInDegrees) => (angleInDegrees - 90) * (Math.PI / 180.0);
    const polarToCartesian = (radius, angleInDegrees) => {
        const a = angleInRadians(angleInDegrees);
        return {
            x: radius * Math.cos(a),
            y: radius * Math.sin(a),
        };
    };

    $: start = polarToCartesian(radius, endAngle);
    $: end = polarToCartesian(radius, startAngle);
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" {style} class={clazz}>
    <g transform="translate(100,100)" stroke={color} stroke-width={thick}>
        <path
            d="M {start.x} {start.y} A {radius} {radius} 0 {endAngle - startAngle <= 180 ? 0 : 1} 0 {end.x} {end.y}"
            fill="none"
        />
    </g>
</svg>

<style>
</style>
