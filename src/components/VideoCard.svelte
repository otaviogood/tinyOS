<script>
    import { GetVideoThumb } from "../utils";

    export let label = "ERROR";
    export let id = "ERROR";
    export let highlight = false;
    export let typed = "";

    function countMatchedChars(typed) {
        let count = 0;
        for (let i = 0; i < label.length; i++) {
            if (label.toUpperCase()[i] === typed.toUpperCase()[i]) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
</script>
<div class="flex flex-row flex-auto items-center {highlight ? 'bg-pink-500' : 'bg-pink-700'} borXXder-2 bordXXer-pink-300 rounded-full rounded-l-none p-1 m-1">
    <img src={GetVideoThumb(id)} alt="" width="12rem" height="12rem" class="w-48 mr-1 rounded-xl"/>
    {#if typed.length <= countMatchedChars(typed)}
        <pre class="flex flex-col justify-center h-14 text-4xl font-bold text-white bg-pink-500" style="background-cXXolor:pink">{label.toUpperCase().substring(0,countMatchedChars(typed))}</pre>
        <pre class="flex flex-col justify-center h-14 text-4xl font-bold text-white bg-pXXink-500" style="background-cXXolor:pink">{label.toUpperCase().substring(countMatchedChars(typed),100)}</pre>
    {:else}
        <pre class="flex flex-col justify-center h-14 text-4xl font-bold text-white" style="background-cXXolor:pink">{label.toUpperCase()}</pre>
    {/if}
</div>
