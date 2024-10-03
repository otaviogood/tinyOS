<style global>
    @tailwind base;
    @tailwind components;
    @tailwind utilities;

    @layer utilities {
        *:not(input):not(textarea) {
            -webkit-user-select: none; /* disable selection/Copy of UIWebView */
            -webkit-touch-callout: none; /* disable the IOS popup when long-press on a link */
        }
        .fit-full-space {
            position: absolute;
            top: 0;
            left: 0px;
            right: 0px;
            bottom: 0px;
        }
        .flex-center-all {
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .rounded-2big {
            border-radius: 2rem;
        }
        .rounded-3big {
            border-radius: 3rem;
        }

        .font-mono {
            font-family: 'Roboto Mono';
        }

        .font-2vmin {
            font-size: 2vmin;
        }
        .font-4vmin {
            font-size: 4vmin;
        }
        .font-8vmin {
            font-size: 8vmin;
        }

        .font-2vw {
            font-size: 2vw;
        }
        .font-4vw {
            font-size: 4vw;
        }
        .font-8vw {
            font-size: 8vw;
        }
        .w-50vw {
            width: 50vw;
        }
        .w-33vw {
            width: 33vw;
        }
        .w-25vw {
            width: 25vw;
        }
        .w-12vw {
            width: 12vw;
        }
        .w-8vw {
            width: 8vw;
        }
        .w-4vw {
            width: 4vw;
        }
        .h-50vh {
            height: 50vh;
        }
        .h-33vh {
            height: 33vh;
        }
        .h-25vh {
            height: 25vh;
        }
        .h-12vh {
            height: 12vh;
        }
        .h-8vwh {
            height: 8vh;
        }
        .h-4vwh {
            height: 4vh;
        }
    }
</style>
