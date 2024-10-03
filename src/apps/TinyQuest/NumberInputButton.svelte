<script>
    import { onMount, createEventDispatcher } from 'svelte';
    let clazz = "";
    export { clazz as class };

    export let value = 0;
    export let min = 0;
    export let max = 100;
    export let step = 1;
    export let decimals = 2;

    let timeoutId;
    let intervalId;
    const initialDelay = 500; // 500ms initial delay
    const repeatInterval = 100; // 100ms repeat interval

    const dispatch = createEventDispatcher();

    function updateValue(newValue) {
        let oldValue = value;
        value = newValue;
        dispatch('change', { value, oldValue });
    }

    function increment() {
        updateValue(Math.min(max, value + step));
    }

    function decrement() {
        updateValue(Math.max(min, value - step));
    }

    function startRepeating(fn) {
        fn();
        timeoutId = setTimeout(() => {
            fn();
            intervalId = setInterval(fn, repeatInterval);
        }, initialDelay);
    }

    function stopRepeating() {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
    }

    onMount(() => {
        return () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };
    });
</script>

<div class="woodgrain-input border-[.5rem] font-bold border-orange-950 rounded-3xl shadow-[0.75rem_0.75rem_0_0_rgba(80,30,10,0.4)] {clazz}">
    <button
        class="active:scale-125 active:bg-orange-600/40 hover:bg-orange-200/50 transform transition-all duration-75"
        on:pointerdown={() => startRepeating(decrement)}
        on:pointerup={stopRepeating}
        on:pointerleave={stopRepeating}
    >
        <i class="fa-solid fa-chevron-left"></i>
    </button>
    <div class="value border-x-[.4rem] border-orange-950 text-orange-950">{value.toFixed(decimals)}</div>
    <button
        class="active:scale-125 active:bg-orange-600/40 hover:bg-orange-200/50 transform transition-all duration-75"
        on:pointerdown={() => startRepeating(increment)}
        on:pointerup={stopRepeating}
        on:pointerleave={stopRepeating}
    >
        <i class="fa-solid fa-chevron-right"></i>
    </button>
</div>

<style>
    .woodgrain-input {
        display: flex;
        align-items: center;
        background: url('/TinyQuest/gamedata/lemonadestand/woodgrain.png');
        background-size: cover;
        overflow: hidden;
        width: fit-content;
    }

    button {
        /* background: none; */
        border: none;
        color: #40101080;
        font-size: 3rem;
        padding: 0.0rem 1rem;
        cursor: pointer;
        /* transition: background-color 0.2s; */
    }

    button:hover {
        /* background-color: rgba(255, 255, 255, 0.2); */
    }

    button:first-child {
        border-top-left-radius: 0.5rem;
        border-bottom-left-radius: 0.5rem;
    }

    button:last-child {
        border-top-right-radius: 0.5rem;
        border-bottom-right-radius: 0.5rem;
    }

    .value {
        background-color: rgba(225, 125, 55, 0.8);
        padding: 0.5rem 0rem;
        width: 7rem;
        text-align: center;
        font-size: 2.5rem;
        font-weight: bold;
    }
</style>