<script>
    import { onMount } from "svelte";
    import { getContext, setContext } from 'svelte';

    export let x0 = 10;
    export let y0 = 10;
    export let x1 = 90;
    export let y1 = 90;
    export let diameter = 1;
    export let color = [1.0,1.0,1.0];

    // const scene = getContext('scene');
    const parentsChildren = getContext('currentChildren');
    const uniqueIndexes = getContext("uniqueIndexes");
    const linesDirty = getContext("linesDirty");

    const myId = uniqueIndexes.i;
    uniqueIndexes.i = (uniqueIndexes.i + 1);

    let dataArr = new Float32Array(4 * 3);
    function recompute() {
        dataArr[0] = x0;
        dataArr[1] = y0;
        dataArr[2] = 0.0;
        dataArr[3] = 2.0;

        dataArr[4] = color[0];
        dataArr[5] = color[1];
        dataArr[6] = color[2];
        dataArr[7] = uniqueIndexes.i & 0x7fffff; // 23 bits that will fit in float32 mantissa???

        dataArr[8] = x1;
        dataArr[9] = y1;
        dataArr[10] = diameter;
        dataArr[11] = 1.0;

        parentsChildren.set(myId, dataArr);
        linesDirty[0] = true;
    }

    $: (x0, y0, x1, y1, diameter, color, recompute());

    onMount(() => {
        // recompute();

        return () => {
            parentsChildren.delete(myId);
            linesDirty[0] = true;
        };
    });

</script>
