<script>
    const temp = ["fa-cloud-sun", "fa-cloud-rain", "fa-cloud-showers-heavy", "fa-sun", "fa-cloud-sun-rain", "fa-cloud-sun-rain", "fa-cloud-sun-rain"];
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const d = new Date();
    let day = d.getDay();

    let weatherData;
    let cleanData = {};
//     ={
//     "@context": [
//         "https://geojson.org/geojson-ld/geojson-context.jsonld",
//         {
//             "@version": "1.1",
//             "wx": "https://api.weather.gov/ontology#",
//             "geo": "http://www.opengis.net/ont/geosparql#",
//             "unit": "http://codes.wmo.int/common/unit/",
//             "@vocab": "https://api.weather.gov/ontology#"
//         }
//     ],
//     "type": "Feature",
//     "geometry": {
//         "type": "Polygon",
//         "coordinates": [
//             [
//                 [
//                     -97.1089731,
//                     39.7668263
//                 ],
//                 [
//                     -97.1085269,
//                     39.7447788
//                 ],
//                 [
//                     -97.0798467,
//                     39.7451195
//                 ],
//                 [
//                     -97.08028680000001,
//                     39.767167
//                 ],
//                 [
//                     -97.1089731,
//                     39.7668263
//                 ]
//             ]
//         ]
//     },
//     "properties": {
//         "updated": "2022-11-21T05:25:12+00:00",
//         "units": "us",
//         "forecastGenerator": "BaselineForecastGenerator",
//         "generatedAt": "2022-11-21T06:33:39+00:00",
//         "updateTime": "2022-11-21T05:25:12+00:00",
//         "validTimes": "2022-11-20T23:00:00+00:00/P7DT2H",
//         "elevation": {
//             "unitCode": "wmoUnit:m",
//             "value": 441.96
//         },
//         "periods": [
//             {
//                 "number": 1,
//                 "name": "Overnight",
//                 "startTime": "2022-11-21T00:00:00-06:00",
//                 "endTime": "2022-11-21T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 21,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "SW",
//                 "icon": "https://api.weather.gov/icons/land/night/skc?size=medium",
//                 "shortForecast": "Clear",
//                 "detailedForecast": "Clear, with a low around 21. Southwest wind 5 to 10 mph."
//             },
//             {
//                 "number": 2,
//                 "name": "Monday",
//                 "startTime": "2022-11-21T06:00:00-06:00",
//                 "endTime": "2022-11-21T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 51,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 mph",
//                 "windDirection": "NW",
//                 "icon": "https://api.weather.gov/icons/land/day/skc?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 51. Northwest wind around 5 mph."
//             },
//             {
//                 "number": 3,
//                 "name": "Monday Night",
//                 "startTime": "2022-11-21T18:00:00-06:00",
//                 "endTime": "2022-11-22T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 24,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 mph",
//                 "windDirection": "SE",
//                 "icon": "https://api.weather.gov/icons/land/night/skc?size=medium",
//                 "shortForecast": "Clear",
//                 "detailedForecast": "Clear, with a low around 24. Southeast wind around 5 mph."
//             },
//             {
//                 "number": 4,
//                 "name": "Tuesday",
//                 "startTime": "2022-11-22T06:00:00-06:00",
//                 "endTime": "2022-11-22T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 54,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "SW",
//                 "icon": "https://api.weather.gov/icons/land/day/few?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 54. Southwest wind 5 to 10 mph."
//             },
//             {
//                 "number": 5,
//                 "name": "Tuesday Night",
//                 "startTime": "2022-11-22T18:00:00-06:00",
//                 "endTime": "2022-11-23T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 26,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 mph",
//                 "windDirection": "SW",
//                 "icon": "https://api.weather.gov/icons/land/night/few?size=medium",
//                 "shortForecast": "Mostly Clear",
//                 "detailedForecast": "Mostly clear, with a low around 26. Southwest wind around 5 mph."
//             },
//             {
//                 "number": 6,
//                 "name": "Wednesday",
//                 "startTime": "2022-11-23T06:00:00-06:00",
//                 "endTime": "2022-11-23T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 52,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "S",
//                 "icon": "https://api.weather.gov/icons/land/day/sct?size=medium",
//                 "shortForecast": "Mostly Sunny",
//                 "detailedForecast": "Mostly sunny, with a high near 52. South wind 5 to 10 mph."
//             },
//             {
//                 "number": 7,
//                 "name": "Wednesday Night",
//                 "startTime": "2022-11-23T18:00:00-06:00",
//                 "endTime": "2022-11-24T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 32,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "W",
//                 "icon": "https://api.weather.gov/icons/land/night/sct?size=medium",
//                 "shortForecast": "Partly Cloudy",
//                 "detailedForecast": "Partly cloudy, with a low around 32. West wind 5 to 10 mph, with gusts as high as 20 mph."
//             },
//             {
//                 "number": 8,
//                 "name": "Thanksgiving Day",
//                 "startTime": "2022-11-24T06:00:00-06:00",
//                 "endTime": "2022-11-24T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 51,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "10 to 15 mph",
//                 "windDirection": "NW",
//                 "icon": "https://api.weather.gov/icons/land/day/few?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 51. Northwest wind 10 to 15 mph, with gusts as high as 25 mph."
//             },
//             {
//                 "number": 9,
//                 "name": "Thursday Night",
//                 "startTime": "2022-11-24T18:00:00-06:00",
//                 "endTime": "2022-11-25T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 27,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "NW",
//                 "icon": "https://api.weather.gov/icons/land/night/few?size=medium",
//                 "shortForecast": "Mostly Clear",
//                 "detailedForecast": "Mostly clear, with a low around 27. Northwest wind 5 to 10 mph."
//             },
//             {
//                 "number": 10,
//                 "name": "Friday",
//                 "startTime": "2022-11-25T06:00:00-06:00",
//                 "endTime": "2022-11-25T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 54,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "W",
//                 "icon": "https://api.weather.gov/icons/land/day/skc?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 54."
//             },
//             {
//                 "number": 11,
//                 "name": "Friday Night",
//                 "startTime": "2022-11-25T18:00:00-06:00",
//                 "endTime": "2022-11-26T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 32,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 mph",
//                 "windDirection": "SW",
//                 "icon": "https://api.weather.gov/icons/land/night/few?size=medium",
//                 "shortForecast": "Mostly Clear",
//                 "detailedForecast": "Mostly clear, with a low around 32."
//             },
//             {
//                 "number": 12,
//                 "name": "Saturday",
//                 "startTime": "2022-11-26T06:00:00-06:00",
//                 "endTime": "2022-11-26T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 56,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 10 mph",
//                 "windDirection": "W",
//                 "icon": "https://api.weather.gov/icons/land/day/few?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 56."
//             },
//             {
//                 "number": 13,
//                 "name": "Saturday Night",
//                 "startTime": "2022-11-26T18:00:00-06:00",
//                 "endTime": "2022-11-27T06:00:00-06:00",
//                 "isDaytime": false,
//                 "temperature": 29,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 mph",
//                 "windDirection": "NW",
//                 "icon": "https://api.weather.gov/icons/land/night/few?size=medium",
//                 "shortForecast": "Mostly Clear",
//                 "detailedForecast": "Mostly clear, with a low around 29."
//             },
//             {
//                 "number": 14,
//                 "name": "Sunday",
//                 "startTime": "2022-11-27T06:00:00-06:00",
//                 "endTime": "2022-11-27T18:00:00-06:00",
//                 "isDaytime": true,
//                 "temperature": 54,
//                 "temperatureUnit": "F",
//                 "temperatureTrend": null,
//                 "windSpeed": "5 to 15 mph",
//                 "windDirection": "W",
//                 "icon": "https://api.weather.gov/icons/land/day/few?size=medium",
//                 "shortForecast": "Sunny",
//                 "detailedForecast": "Sunny, with a high near 54."
//             }
//         ]
//     }
// };

    // // 37.4419, 122.1430 <- get the negative signs right for east/west.
    // fetch("https://api.weather.gov/points/37.4419,-122.1430")
    //     .then((response) => response.json())
    //     .then((data) => console.log(data));



    fetch("https://api.weather.gov/gridpoints/MTR/91,89/forecast/hourly")
        .then((response) => response.json())
        .then((data) => {
            // console.log(data);
            weatherData = data
            let periods = weatherData.properties.periods;
            for (let i = 0; i < periods.length; i++) {
                let day = periods[i].name;
                let temp = periods[i].temperature;
                let icon = periods[i].icon;
                let desc = periods[i].shortForecast;
                let time = periods[i].startTime;
                let isDaytime = periods[i].isDaytime;
                let date = new Date(time);
                let dayOfWeek = date.getDay();
                let dayOfWeekName = daysOfWeek[dayOfWeek];
                let dayOfWeekNameShort = dayOfWeekName.slice(0, 3);
                let dn = isDaytime ? "Day" : "Night";
                if (dayOfWeekName in cleanData) {
                    cleanData[dayOfWeekName].day = dayOfWeekNameShort;
                    cleanData[dayOfWeekName].dayLong = dayOfWeekName;
                    cleanData[dayOfWeekName].tempLow = Math.min(temp, cleanData[dayOfWeekName].tempLow);
                    cleanData[dayOfWeekName].tempHigh = Math.max(temp, cleanData[dayOfWeekName].tempHigh);
                    cleanData[dayOfWeekName]["icon" + dn] = icon;
                    cleanData[dayOfWeekName].desc = desc;
                } else {
                    if (isDaytime)
                        cleanData[dayOfWeekName] = {
                            "day": dayOfWeekNameShort,
                            "dayLong": dayOfWeekName,
                            tempHigh: temp,
                            tempLow: temp,
                            "iconDay": icon,
                            desc: desc
                        }
                    else
                        cleanData[dayOfWeekName] = {
                            "day": dayOfWeekNameShort,
                            "dayLong": dayOfWeekName,
                            tempHigh: temp,
                            tempLow: temp,
                            "iconNight": icon,
                            desc: desc
                        }
                }
            }
        });

        function colorize(temp) {
            let color = "";
            if (temp < 40) {
                color = "blue";
            } else if (temp < 60) {
                color = "green";
            } else if (temp < 80) {
                color = "yellow";
            } else if (temp < 100) {
                color = "orange";
            } else {
                color = "red";
            }
            return color;
        }
</script>

<div class="flex-center-all h-screen w-screen">
    <div class="flex flex-row w-11/12 h-4/6">
        {#if weatherData}
            {#each Object.values(cleanData) as weather, i}
                <div class="flex-center-all flex-col w-full h-1/12 border rounded-full {i === 0 ? 'border-white' : 'border-gray-800'} bg-blue-900 text-4xl" style="widXXth:4rem">
                    <div class="pt-2 text-6xl my-2" style="color:{colorize(weather.tempHigh)}">{weather.tempHigh}</div>
                    <img src={weather["iconDay"]} alt="icon" width="160px" class="wXX-1/2 hXX-1/2 my-1">
                    <img src={weather["iconNight"]} alt="icon" width="160px" class="wXX-1/2 hXX-1/2 my-1">
                    <div class="pt-2 text-6xl my-2" style="color:{colorize(weather.tempLow)}">{weather.tempLow}</div>
                    <!-- <div class="text-6xl"><i class="fas {temp[i]}"></i></div> -->
                    <!-- <div class="pt-2">{daysOfWeek[(day+i)%7]}</div> -->
                    <div class="mt-2 text-3xl">{weather.dayLong}</div>
                </div>
            {/each}
        {/if}

    </div>
</div>




