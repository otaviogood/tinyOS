<script>
    // Notes
    // large and small cups charge different prices
    // Charitable cause: If the stand is raising money for a cause, people might be willing to pay a bit more.
    // snacks or flavored lemonade (strawberry lemonade)
    // demand: kids, parents, joggers, tourists
    // special events: holidays, events, etc.

    import "./TailwindStyles.svelte";
    import { onMount, tick } from "svelte";
    import { slide, fade, scale } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import { pop } from "svelte-spa-router";
    import { Town } from "./places";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import CloseButton from "../../components/CloseButton.svelte";
    import {
        invAspectRatio,
        fullWidth,
        fullHeight,
        landscape,
        bigWidth,
        bigHeight,
        bigScale,
        bigPadX,
        bigPadY,
        handleResize,
    } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { pulseShadow, scaleDown, scalePulse } from "./Transitions";
    import { speechPlay } from "../../utils";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import NumberInputButton from "./NumberInputButton.svelte";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_score = new Howl({ src: ["/TinyQuest/sfx/sfx_menu_move4.wav"], volume: 0.25 });

    let started = 0; // 0 means not started, >0 means the game has started
    let town;
    let gameType;

    let day = 1;
    const startingMoney = 10;
    let moneyDollars = startingMoney;
    let inventoryCups = 10;
    let priceCharging = 1.0;
    let advertisingSigns = 0;
    let weatherForecast = 2; // 0=heatwave, 1=sunny, 2=partlycloudy, 3=cloudy, 4=rainy, 5=thunderstorm
    const weatherTypes = ["Heat Wave", "Sunny", "Partly Cloudy", "Cloudy", "Rainy", "Thunderstorm"];
    const weatherEmojis = ["🔥", "☀️", "🌤️", "🌥️", "🌧️", "⛈️"];
    let actualWeather = null; // 0=heatwave, 1=sunny, 2=partlycloudy, 3=cloudy, 4=rainy, 5=thunderstorm
    let demand = 0;
    let profit = 0;
    let sales = null;
    let baseDemand = 0;
    let adjustedBaseDemand = 0;
    let bestProfit = 0;
    let bestDay = 0;
    let bestWeather = 5;
    let totalCupsSold = 0;
    let cupPrice = 0.5;
    let signPrice = 0.25;
    let bestRank = -1;

    let dayStory = "";

    let gameState = "setup"; // Possible values: 'setup', 'results', 'intro', 'win', 'fail'

    let characterX = 0;
    let characterY = 0;
    let characterScale = 8; // Adjust this value to change the character size

    let visibleDots = 0;

    let dayimages = [
        "day_heat_wave.webp",
        "day_sunny.webp",
        "day_partly_cloudy.webp",
        "day_overcast.webp",
        "day_rainy.webp",
        "day_thunderstorm.webp",
    ];
    let weatherImages = [
        "weather_heatwave.webp",
        "weather_sunny.webp",
        "weather_partly_cloudy.webp",
        "weather_overcast.webp",
        "weather_rainy.webp",
        "weather_thunderstorm.webp",
    ];

    function randomizeWeather() {
        weatherForecast = getRandomInt(0, weatherTypes.length - 1);
        // Make heatwaves less likely - it should feel special.
        if (weatherForecast === 0 && getRandomInt(10) < 7) weatherForecast = getRandomInt(0, weatherTypes.length - 1);
        actualWeather = null;
    }

    function startNextDay() {
        visibleDots = 0;
        actualWeather = null;
        day++;
        gameState = "setup";
        sales = null;
        randomizeWeather();
        while (totalCost(inventoryCups, advertisingSigns) > moneyDollars && advertisingSigns > 0) advertisingSigns--;
        while (totalCost(inventoryCups, advertisingSigns) > moneyDollars && inventoryCups > 0) inventoryCups--;

        if (moneyDollars < cupPrice) {
            gameState = "fail";
        } else if (day > 31) {
            gameState = "win";
            snd_fanfare.play();
            $earnedStar = true;
        }
    }

    function resetGame() {
        day = 0; // 0 because startNextDay takes it to 1
        moneyDollars = startingMoney;
        inventoryCups = 10;
        priceCharging = 1.0;
        advertisingSigns = 0;
        demand = 0;
        profit = 0;
        bestProfit = 0;
        bestDay = 0;
        bestWeather = 5;
        totalCupsSold = 0;
        bestRank = -1;
        dayStory = "";
        startNextDay();
        // setTimeout(() => {
        //     // DEBUGGING *******************************
        //     simulateDay();
        // }, 200);
    }

    function totalCost(inventoryCups, advertisingSigns) {
        return inventoryCups * cupPrice + advertisingSigns * signPrice;
    }

    function simulateDay() {
        let adFactor = 1 + Math.sqrt(advertisingSigns * 0.1);
        baseDemand = (getRandomInt(10, 75) + getRandomInt(10, 75)) / 2;
        console.log("baseDemand", baseDemand);
        adjustedBaseDemand = baseDemand * adFactor;
        actualWeather = Math.max(0, Math.min(weatherTypes.length - 1, weatherForecast + [-1, 0, 0, 0, 1][getRandomInt(5)]));
        let weatherFactor = [1.0, 0.5, 0.4, 0.2, 0.1, 0.03][actualWeather];
        adjustedBaseDemand *= weatherFactor;
        let priceFactor = 1;
        // priceFactor should always be <= 1 because it's a multiplier on base demand and we can't have more than 100% of the demand
        // If price is 0, we should get all the demand, then it should go down from there.
        // https://graphtoy.com/?f1(x,t)=1/(1+x*.5)&v1=true&f2(x,t)=&v2=false&f3(x,t)=&v3=false&f4(x,t)=&v4=false&f5(x,t)=&v5=false&f6(x,t)=&v6=false&grid=1&coords=0,0,12
        //priceFactor = 1 / (1 + priceCharging * 0.85);
        // This one doesn't have an ever-increasing optimal.
        // https://graphtoy.com/?f1(x,t)=x/(1+x*.85)&v1=true&f2(x,t)=x/(1+exp(x*.25+.15))&v2=true&f3(x,t)=x/(1+x%5E1.9)&v3=true&f4(x,t)=&v4=false&f5(x,t)=&v5=false&f6(x,t)=&v6=false&grid=1&coords=4.289716429963566,0.44848652921854715,11.70421251427057
        priceFactor = 1 / (1 + Math.exp(priceCharging * 0.25 + 0.15));

        // Log all these vars
        console.log("adjustedBaseDemand", adjustedBaseDemand);
        console.log("weatherFactor", weatherFactor);
        // console.log("idealPrice", idealPrice);
        console.log("priceFactor", priceFactor);
        console.log("adFactor", adFactor);

        demand = Math.floor(adjustedBaseDemand * priceFactor);
        sales = Math.min(demand, inventoryCups);
        totalCupsSold += sales;

        profit = sales * priceCharging - totalCost(inventoryCups, advertisingSigns);
        moneyDollars += profit;

        if (profit > bestProfit) {
            bestProfit = profit;
            bestDay = day;
            bestWeather = actualWeather;
            console.log("bestProfit", bestProfit, "bestDay", bestDay, "bestWeather", bestWeather);
        }

        if (profit > 0) {
            snd_good.play();
        } else {
            snd_error.play();
        }

        gameState = "results";
        visibleDots = 0;

        dayStory = generateStory();
    }

    function randStr(...args) {
        if (args.length === 0) return "";
        let r = getRandomInt(args.length);
        return args[r];
    }
    function generateStory() {
        let events = [];

        // Check for rare weather events
        if (actualWeather === 0) {
            events.push("A scorching heatwave swept through town.");
        } else if (actualWeather === 5) {
            events.push("A severe thunderstorm hit the area.");
        }

        // Check if you sold out of inventory
        if (sales === inventoryCups && sales > 0) {
            events.push(randStr("You sold all of your lemonade."));
            if (demand > inventoryCups) {
                // more customers wanted lemonade than you had available
                events.push(randStr("You ran out of lemonade!", "You didn't make enough lemonade!"));
            }
        }

        // Analyze cups made vs. cups sold
        if (sales > 0 && sales === inventoryCups && sales === demand) {
            events.push("You made a good amount of lemonade.");
        } else if (inventoryCups > sales * 1.6 && sales > 2) {
            events.push(randStr("You made more lemonade than you sold.", "You made too much lemonade."));
        } else if (demand > inventoryCups * 1.6 && sales > 2) {
            events.push(
                randStr(
                    "You could have sold way more if you had more lemonade.",
                    "You could have sold more if you had more lemonade."
                )
            );
        }

        // Check for zero sales
        if (sales === 0) {
            if (inventoryCups === 0) {
                events.push("You had nothing to sell today.");
            } else if (demand === 0) {
                events.push("No customers showed up today.");
            } else {
                events.push("You had lemonade, but nobody bought it.");
            }
        }

        // Check for high profit or loss
        if (profit > 70) {
            events.push(`People LOVE your lemonade! You made a huge profit of $${profit.toFixed(2)}.`);
        } else if (profit > 20) {
            events.push(`A good day! You made a profit of $${profit.toFixed(2)}.`);
        } else if (profit < -8) {
            events.push(`A tough day. You lost $${(-profit).toFixed(2)}.`);
        }

        // Check for unusually high or low price
        // if (priceCharging > 3) {
        //     events.push("Customers complained about the high price of your lemonade.");
        // } else if (priceCharging < 0.5) {
        //     events.push("People were delighted by your low prices!");
        // }

        // Check for high or low demand
        //if (adjustedBaseDemand === 0) events.push("NOBODY even came out today. NOBODY!"); // impossible condition
        if (demand > 10 && sales === 0) {
            events.push("There were so many customers, but you sold nothing. Maybe your prices were too high?");
        } else if (demand > 40) {
            events.push("An unexpected surge of customers flooded your stand!");
        } else if (demand === 0) {
            events.push("NOBODY wanted your lemonade today.");
        } else if (demand < 4) {
            events.push(
                randStr(
                    "Hardly anyone was out today.",
                    "The streets were nearly empty today.",
                    "It was a very slow day for business.",
                    "You saw very few customers today."
                )
            );
        }

        // Check for sales despite bad weather
        if (actualWeather === 5 && sales > 0) {
            events.push("AMAZING! Despite the bad weather, people still bought lemonade from you.");
        }
        if (actualWeather === 4 && sales > 2) {
            events.push("Wow, you sold some lemonade despite the rain.");
        }

        // If there are interesting events, create a story from them
        let story = events.join(" ");

        // If the story is less than 2 sentences, add filler
        let sentenceCount = (story.match(/\./g) || []).length;
        if (sales > 0 && sentenceCount < 2) {
            let customerTypes = ["kids", "parents", "joggers", "tourists", "construction workers", "grandmas", "students"];
            let customerTypesSingular = ["dog walker", "clown", "bird", "biker", "cat", "monkey"];
            let randomCustomer = customerTypes[getRandomInt(0, customerTypes.length - 1)];
            let randomCustomerSingular = customerTypesSingular[getRandomInt(0, customerTypesSingular.length - 1)];
            let filler = randStr(
                `A sad ${randomCustomerSingular} stopped by your stand.`,
                `You noticed a ${randomCustomerSingular} walking by today.`,
                `You saw a ${randomCustomerSingular} enjoying your lemonade.`,
                `A ${randomCustomerSingular} bought a cup of lemonade from you today.`,
                `Lemonade is so yummy though!`,
                "Maybe more sugar would help.",
                `Maybe the ${randomCustomerSingular} you saw would like less sugar.`
            );
            if (sales > 16) {
                filler = randStr(
                    "Your lemonade stand became a local sensation!",
                    "People were talking about your lemonade all over town!",
                    "You had to call for backup to handle all the customers!",
                    "The line for your lemonade stretched around the block!",
                    "You've become the talk of the neighborhood!",
                    "Local news reporters came to cover your booming business!",
                    "People were offering to buy your secret recipe!",
                    `Several ${randomCustomer} stopped by your stand.`,
                    "It felt like the whole neighborhood came for your lemonade!"
                );
            } else if (sales > 8) {
                filler = randStr(
                    "What an incredible day!",
                    "Your stand was buzzing with activity!",
                    "You could barely keep up with the demand!",
                    "Your stand attracted a steady stream of customers.",
                    "People were lining up for your lemonade!",
                    `You saw many ${randomCustomer} at your stand.`,
                    "Word spread quickly about your delicious lemonade!",
                    `A group of ${randomCustomer} became regular customers.`
                );
            } else if (sales > 3) {
                filler = randStr(
                    "What a fun day!",
                    "Your lemonade was a hit!",
                    "People seemed to enjoy your lemonade.",
                    `A group of ${randomCustomer} really liked your lemonade.`,
                    "You had some satisfied customers today.",
                    "You received compliments on your lemonade recipe.",
                    "A few customers asked if you'd be open tomorrow too!"
                );
            }
            story += " " + filler;
        }

        return story.trim();
    }

    function generateFinalStory() {
        let profit = moneyDollars - startingMoney;
        let story = "";
        bestRank = -1;

        if (moneyDollars < cupPrice) {
            // Lost all starting money
            story = "Oh no! You lost all your starting money and went bankrupt. Next time, try adjusting your strategy!";
        } else if (profit < 0) {
            // Negative profit
            story = "You ended up with less money than you started. Maybe consider changing your prices or advertising.";
        } else if (profit >= 0 && profit < 10) {
            story = `You made a small profit of $${profit.toFixed(2)}. Not bad for a start, but there's room for improvement!`;
        } else if (profit >= 10 && profit < 100) {
            story = `Great job! You earned a profit of $${profit.toFixed(
                2
            )}. With some tweaks, you could earn even more. You earned a BRONZE medal!`;
            bestRank = 0;
        } else if (profit >= 100 && profit < 500) {
            story = `Fantastic work! You made a substantial profit of $${profit.toFixed(
                2
            )}! Your lemonade stand is thriving! You should start a company. You earned a SILVER medal!`;
            bestRank = 1;
        } else if (profit >= 500) {
            story = `Incredible! You're a lemonade tycoon with a massive profit of $${profit.toFixed(
                2
            )}! Your success is legendary! You earned a GOLD medal!`;
            bestRank = 2;
        }
        return story;
    }

    async function animateDots() {
        visibleDots = 0;
        let startDay = day;
        for (let i = 0; i < sales; i++) {
            snd_score.play();
            if (day !== startDay) break;
            await tick(); // Ensure DOM updates
            if (day !== startDay) break;
            // await new Promise((resolve) => setTimeout(resolve, Math.max(48, 200 - visibleDots * 5))); // 100ms delay between each dot
            await new Promise((resolve) => setTimeout(resolve, 333)); // 100ms delay between each dot
            visibleDots++;
        }
    }

    $: if (sales !== null) {
        animateDots();
    }

    async function startGame() {
        snd_button.play();
        started++; // Increment started to trigger reactivity
        resetGame();
    }

    function resetToSplashScreen() {
        started = 0;
        pop();
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex] ?? new Town(0.0, 0.0, "LEMONADE STAND", "/TinyQuest/lemonadestand");
        gameType = town?.options?.game;
    });

    handleResize();
    // startGame();
</script>

<FourByThreeScreen>
    {#if started === 0}
        <div class="flex-center-all h-full flex flex-col">
            <img
                src="TinyQuest/gamedata/lemonadestand/splash_screen.webp"
                class="absolute inset-0 w-full h-full object-cover"
                alt="lemonade stand"
                draggable="false"
            />
            <div
                in:fade={{ duration: 2000 }}
                class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1"
                style="margin-top:44rem;background-color:#40101080"
            >
                {town?.name}
            </div>
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                on:pointerup|preventDefault|stopPropagation={startGame}>START</button
            >
        </div>
    {:else}
        {#key started}
            <div class="relative flex flex-col h-full w-full bg-yellow-100 text-orange-950 font-bold">
                {#if gameState === "setup"}
                    <img
                        src="TinyQuest/gamedata/lemonadestand/bg_screen1.webp"
                        alt="Background"
                        class="absolute inset-0 w-full h-full object-cover"
                        draggable="false"
                    />
                    <div class="absolute right-[20rem] top-[16.25rem] text-right text-6xl mb-4 font-mono woodtext">
                        ${moneyDollars.toFixed(2)}
                    </div>
                    <div class="absolute right-[20rem] top-[24rem] text-right text-6xl mb-4 font-mono woodtext text-red-700">
                        -${totalCost(inventoryCups, advertisingSigns).toFixed(2)}
                    </div>
                    <div class="absolute right-[20rem] top-[29rem] text-right text-6xl mb-4 font-mono woodtext">
                        <hr class="border-[.25rem] border-orange-950 w-[16rem]" />
                    </div>
                    <div class="absolute right-[20rem] top-[32rem] text-right text-6xl mb-4 font-mono woodtext">
                        ${(moneyDollars - totalCost(inventoryCups, advertisingSigns)).toFixed(2)}
                    </div>

                    <div class="absolute left-[21.5rem] top-[16.25rem] text-7xl woodtext">Day {day}</div>
                    <div class="absolute left-[21.5rem] top-[23rem] text-5xl woodtext">Forecast</div>
                    <div
                        class="absolute left-[21.5rem] top-[26.5rem] border-4 border-orange-950 text-4xl font-bold bg-sky-300 p-2 rounded-lg"
                    >
                        {weatherTypes[weatherForecast]}
                    </div>
                    <img
                        src={`TinyQuest/gamedata/lemonadestand/${weatherImages[weatherForecast]}`}
                        class="absolute left-[39.4rem] top-[21.4rem] inline-block w-[21.0rem] h-[21.0rem] rounded-2xl inner-shadow"
                        alt="weather forecast"
                        draggable="false"
                    />
                    <div class="flex flex-row justify-between">
                        <div class="absolute top-[49.5rem] left-[23.4rem] flex flex-col items-center">
                            <img
                                src="TinyQuest/gamedata/lemonadestand/store.webp"
                                alt="Store"
                                class="w-[14rem] h-[14rem]"
                                draggable="false"
                            />
                            <label for="inventoryCups" class="absolute -top-[4.3rem] left-[1.4rem] text-4xl woodtext"
                                >Cups&nbsp;${(inventoryCups * cupPrice).toFixed(2)}</label
                            >
                            <NumberInputButton
                                class="absolute top-[17.75rem]"
                                bind:value={inventoryCups}
                                min={0}
                                max={200}
                                step={1}
                                decimals={0}
                                on:change={(event) => {
                                    if (totalCost(inventoryCups, advertisingSigns) > moneyDollars) {
                                        inventoryCups = event.detail.oldValue;
                                    }
                                }}
                            />
                        </div>
                        <div class="absolute top-[49.5rem] left-[44.3rem] flex flex-col items-center">
                            <img
                                src="TinyQuest/gamedata/lemonadestand/sign.webp"
                                alt="Store"
                                class="w-[14rem] h-[14rem]"
                                draggable="false"
                            />
                            <label for="advertisingSigns" class="absolute -top-[4.3rem] left-[1rem] text-4xl woodtext"
                                >Signs&nbsp;${(advertisingSigns * signPrice).toFixed(2)}</label
                            >
                            <NumberInputButton
                                class="absolute top-[17.75rem]"
                                bind:value={advertisingSigns}
                                min={0}
                                max={20}
                                step={1}
                                decimals={0}
                                on:change={(event) => {
                                    if (totalCost(inventoryCups, advertisingSigns) > moneyDollars) {
                                        advertisingSigns = event.detail.oldValue;
                                    }
                                }}
                            />
                        </div>
                        <div class="absolute top-[49.5rem] left-[64.9rem] flex flex-col items-center">
                            <img
                                src="TinyQuest/gamedata/lemonadestand/money.webp"
                                alt="Store"
                                class="w-[14rem] h-[14rem]"
                                draggable="false"
                            />
                            <label for="priceCharging" class="absolute -top-[4.3rem] left-[1.4rem] text-4xl woodtext"
                                >Price&nbsp;${priceCharging.toFixed(2)}</label
                            >
                            <NumberInputButton
                                class="absolute top-[17.75rem]"
                                bind:value={priceCharging}
                                min={0.0}
                                max={20}
                                step={0.1}
                                decimals={2}
                            />
                        </div>
                    </div>
                    <button on:pointerup={simulateDay} class="absolute top-[39.5rem] left-[63rem] w-[18rem] nextbutton">Go</button
                    >
                {:else if gameState === "results"}
                    <img
                        src="TinyQuest/gamedata/lemonadestand/bg_wood.webp"
                        alt="Background"
                        class="absolute inset-0 w-full h-full object-cover"
                        draggable="false"
                    />
                    <div class="absolute left-[6.5rem] top-[45rem] w-[36rem] text-center text-6xl font-bold p-2 rounded-lg">
                        Weather
                    </div>
                    <div class="absolute left-[6.5rem] top-[50rem] w-[36rem] text-center text-6xl font-bold p-2 rounded-lg">
                        {weatherTypes[actualWeather]}
                    </div>
                    <div
                        class="w-[35.7rem] h-[34.4rem] border-4 border-orange-950 relative ml-[6.7rem] mt-[9.9rem] rounded-tr-3xl"
                    >
                        <img
                            src={`TinyQuest/gamedata/lemonadestand/${dayimages[actualWeather]}`}
                            class="w-full h-full [box-shXXXadow:1.5rem_1.5rem_0_rgba(60,20,7,1.0)] rounded-tr-3xl"
                            alt="day image"
                            draggable="false"
                        />
                        <!-- <svg
                            width={32 * characterScale}
                            height={40 * characterScale}
                            viewBox="0 0 32 40"
                            class="absolute top-4 left-[30rem] pixelated"
                            style="width: {characterScale}rem; height: {characterScale * 1.25}rem;"
                        >
                            <image
                                href="TinyQuest/gamedata/lemonadestand/characters.png"
                                x={-characterX}
                                y={-characterY}
                                width="320"
                                height="160"
                            />
                        </svg> -->
                        {#key sales}
                            {#if sales !== null}
                                {#each Array.from({ length: visibleDots }, (_, i) => i) as i}
                                    <img
                                        src={`TinyQuest/gamedata/lemonadestand/cup.webp`}
                                        class="absolute w-12 m-2 drop-shadow-[0_0_4px_rgba(0,0,0,.75)]"
                                        style="left: {(i * 3.5) % 35}rem; top: {Math.floor((i * 3.5) / 35) * 3.5}rem;"
                                        alt="cup"
                                        draggable="false"
                                    />
                                {/each}
                            {/if}
                            {#if sales === visibleDots}
                                <div
                                    in:scale={{ delay: 200, duration: 1500, start: 8.0 }}
                                    class="absolute -top-[3rem] left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-8xl w-36 h-36 flex-center-all rounded-full bg-sky-600 font-bold text-yellow-300 drop-shadow-[0_0_8px_rgba(95,145,255,1.0)]"
                                >
                                    {sales}
                                </div>
                            {/if}
                        {/key}
                    </div>
                    <div
                        class="absolute right-[11.5rem] top-[11.25rem] text-right text-6xl mb-4 font-mono chalktext text-gray-300"
                    >
                        Sales ${(Math.min(sales, visibleDots) * priceCharging).toFixed(2)}
                    </div>
                    {#if visibleDots >= sales}
                        <div
                            in:fade={{ duration: 500 }}
                            class="absolute right-[11.5rem] top-[18rem] text-right text-6xl mb-4 font-mono chalktext text-red-300"
                        >
                            -${(inventoryCups * cupPrice).toFixed(2)}
                        </div>
                        <img
                            in:fade={{ duration: 500 }}
                            src="TinyQuest/gamedata/lemonadestand/store.webp"
                            alt="Store"
                            class="w-[6rem] h-[6rem] absolute right-[4rem] top-[17rem] rounded-full border-4 border-gray-300"
                            draggable="false"
                        />
                        <div
                            in:fade={{ duration: 500 }}
                            class="absolute right-[11.5rem] top-[23rem] text-right text-6xl mb-4 font-mono chalktext"
                        >
                            <hr class="border-[.25rem] border-gray-300 w-[16rem]" />
                        </div>
                        <div
                            in:fade={{ duration: 500, delay: 500 }}
                            class="absolute right-[11.5rem] top-[26rem] text-right text-6xl mb-4 font-mono chalktext text-gray-300"
                        >
                            ${(sales * priceCharging - inventoryCups * cupPrice).toFixed(2)}
                        </div>

                        <div
                            in:fade={{ duration: 500, delay: 1000 }}
                            class="absolute right-[11.5rem] top-[33rem] text-right text-6xl mb-4 font-mono chalktext text-red-300"
                        >
                            -${(advertisingSigns * signPrice).toFixed(2)}
                        </div>
                        <img
                            in:fade={{ duration: 500, delay: 1000 }}
                            src="TinyQuest/gamedata/lemonadestand/sign.webp"
                            alt="Store"
                            class="w-[6rem] h-[6rem] absolute right-[4rem] top-[32rem] rounded-full border-4 border-gray-300"
                            draggable="false"
                        />
                        <div
                            in:fade={{ duration: 500, delay: 1000 }}
                            class="absolute right-[11.5rem] top-[38rem] text-right text-6xl mb-4 font-mono chalktext"
                        >
                            <hr class="border-[.25rem] border-gray-300 w-[16rem]" />
                        </div>
                        <div
                            in:fade={{ duration: 500, delay: 1500 }}
                            class="absolute right-[11.5rem] top-[41rem] text-right text-6xl mb-4 font-mono chalktext text-green-300"
                        >
                            Profit ${(sales * priceCharging - inventoryCups * cupPrice - advertisingSigns * signPrice).toFixed(2)}
                        </div>
                    {/if}

                    <!-- <div class="text-2xl mb-4">
                        Demand: {demand}<br />
                        {#if sales !== null}
                            Money made: ${(sales * priceCharging).toFixed(2)}<br />
                        {/if}
                        Profit: ${profit.toFixed(2)}<br />
                        Inventory Cost: ${(inventoryCups * cupPrice).toFixed(2)}<br />
                        Advertising Cost: ${(advertisingSigns * signPrice).toFixed(2)}<br />
                    </div> -->
                    <div
                        class="absolute right-[2rem] top-[55rem] w-[45rem] text-4xl bg-[#f8f0a0] p-4 rounded [box-shadow:.5rem_.5rem_0_rgba(60,20,7,1.0)]"
                    >
                        {dayStory}
                    </div>
                    <!-- a calendar graphic to show which day of the month we are on-->
                    <div
                        class="absolute left-[3rem] top-[57.5rem] w-[15rem] h-[14rem] text-xl bg-[#f8f0a0] p-2 rounded-xl [box-shadow:.5rem_.5rem_0_rgba(60,20,7,1.0)] flex flex-col"
                    >
                        <div class="text-2xl font-bold mb-2 text-center">Day: {day}</div>
                        <div class="grid grid-cols-7 gap-1 w-full h-full text-center auto-rows-fr">
                            {#each Array(31) as _, index}
                                {#if index === day}
                                    <div class="bg-yellow-100 rounded-sm flex items-center justify-center h-full drop-shadow">
                                        <i class="fas fa-chevron-right text-yellow-400" />
                                    </div>
                                {:else if index < day}
                                    <div class="bg-green-300 rounded-sm flex items-center justify-center h-full drop-shadow">
                                        <i class="fas fa-check text-green-700" />
                                    </div>
                                {:else}
                                    <div class="bg-gray-100 rounded-sm flex items-center justify-center h-full drop-shadow" />
                                {/if}
                            {/each}
                        </div>
                    </div>

                    <button on:pointerup={startNextDay} class="absolute bottom-[2.5rem] left-[29rem] nextbutton">Next Day</button>
                {:else if gameState === "win" || gameState === "fail"}
                    <img
                        src="TinyQuest/gamedata/lemonadestand/bg_end.webp"
                        alt="Background"
                        class="absolute inset-0 w-full h-full object-cover"
                        draggable="false"
                    />
                    <div class="absolute left-[4.5rem] top-[45rem] w-[40rem] text-center text-4xl font-bold p-2 rounded-lg">
                        Best Day was {weatherTypes[bestWeather]}
                    </div>
                    <div class="absolute left-[4.5rem] top-[50rem] w-[40rem] text-center text-4xl font-bold p-2 rounded-lg">
                        ${bestProfit.toFixed(2)} profit
                    </div>
                    <div
                        class="w-[35.7rem] h-[34.4rem] border-4 border-orange-950 relative ml-[6.7rem] mt-[9.9rem] rounded-tr-3xl"
                    >
                        <img
                            src={`TinyQuest/gamedata/lemonadestand/${dayimages[bestWeather]}`}
                            class="w-full h-full [box-shXXXadow:1.5rem_1.5rem_0_rgba(60,20,7,1.0)] rounded-tr-3xl"
                            alt="day image"
                            draggable="false"
                        />
                    </div>
                    <div class="absolute right-[3rem] top-[10rem] text-right text-6xl mb-4 font-mono woodtext text-orange-950">
                        Profit: ${(moneyDollars - startingMoney).toFixed(2)}
                    </div>
                    <div class="absolute right-[3rem] top-[19rem] text-right text-6xl mb-4 font-mono woodtext text-orange-950">
                        Total cups sold: {totalCupsSold}
                    </div>

                    {#if bestRank >= 0}
                        <img
                            src="TinyQuest/gamedata/lemonadestand/trophy_{['bronze', 'silver', 'gold'][bestRank]}.webp"
                            alt="Trophy"
                            class="absolute h-[36rem] left-[66rem] top-[22rem]"
                            draggable="false"
                        />
                    {/if}

                    <div
                        class="absolute right-[2rem] top-[58rem] w-[45rem] text-4xl bg-[#f8f0a0] p-4 rounded [box-shadow:.5rem_.5rem_0_rgba(60,20,7,1.0)]"
                    >
                        {generateFinalStory()}
                    </div>
                    <button on:pointerup={startGame} class="absolute bottom-[2.5rem] left-[29rem] nextbutton">Play again</button>
                {/if}
            </div>
            <CloseButton />
        {/key}
    {/if}
</FourByThreeScreen>

<style>
    /* Add any additional styles here */
    .woodtext {
        @apply font-bold drop-shadow-[0_0_8px_rgba(255,230,180,1)];
    }
    .chalktext {
        @apply font-bold drop-shadow-[0_0_8px_rgba(0,0,0,1)];
    }
    .nextbutton {
        @apply bg-green-500 border-4 border-orange-950 text-orange-950 font-bold text-5xl rounded-3xl px-8 py-3;
    }
    .pixelated {
        image-rendering: pixelated;
        image-rendering: crisp-edges;
    }
</style>
