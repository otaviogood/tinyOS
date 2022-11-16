<script>
    const temp = ["fa-cloud-sun", "fa-cloud-rain", "fa-cloud-showers-heavy", "fa-sun", "fa-cloud-sun-rain", "fa-cloud-sun-rain", "fa-cloud-sun-rain"];
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const d = new Date();
    let day = d.getDay();
</script>

<div class="flex-center-all h-screen w-screen">
    <div class="flex flex-row w-11/12 h-5/6">
        {#each Array(7) as abc, i}
            <div class="flex-center-all flex-col w-full h-1/12 border {i === 0 ? 'border-white' : 'border-gray-800'} bg-blue-900 text-4xl">
                <div class="text-8xl"><i class="fas {temp[i]}"></i></div>
                <div class="pt-2">{daysOfWeek[(day+i)%7]}</div>
            </div>
        {/each}

    </div>
</div>
