const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const app = express();

app.use(cors());
app.use(express.json());

const LOGO_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCADYAlsDASIAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAMFBgQCAQj/xAA6EAABBAIBAgUDAgUDAwMFAAABAAIDBAUREgYhExQiUqExgbEyNAcVQVFhFiNCJDNxU5HhFyXB09T/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A/HlqeVk7mtfoDWhodu3/AMqPzM3v+Alz9y/7fhQoJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4CeZm9/wABQogm8zN7/gJ5mb3/AAFCiCbzM3v+AnmZvf8AAUKIJvMze/4C7K55wtc9/qP19RH4KrVY0/2zPv8AlByXP3L/ALfhQqa5+5f9vwoUBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBWNP9sz7/lVysaf7Zn3/ACg5Ln7l/wBvwoVNc/cv+34UKAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIunGY+/lLsdHGUrN63ICWQV4nSSO0C46a0EnQBJ/wCg5kWxq/w/vTw1GHN4OLI22bixslh4sBx3xjcQwxse7t2c8a2A7iQQMnbrWKduapbglr2IJHRyxSsLXxvadFrge4IIIIKCJERARF14fG3sxk4Mbja7rFud3GONpA/pskk9gAASXEgAAkkAIORaqv0xHiOdnrWO7jmeG7waLOLLcz9uaAWuB8IAjZ5jZGuIIdybYOk6Z6Qo2acdah1J1CZHsN1wdJSrM05mo2OAEriDy5uHY8eIBbydlv/uOcyjnBs965Yfs6Be97j8lBeWeucwOcGDjrYGnIyON1fHQtj5hgIaXv1zkI2fU4k9yd7JVnkspk8d/Dm1Q6hE1ufOujloMnc0ms2KQF1jiduaXeqNpAGwZO/pIPLAzE9FPE9+Kpl+ooZw3+Wytea9TjokzEFvN/fjwafSQ7kQW8XZXN5S/msrYymUsvs27DuUkjgB/TQAA7NaAAA0AAAAAAABBxoiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICsaf7Zn3/ACq5WNP9sz7/AJQclz9y/wC34UKmufuX/b8KFAREQEREBERAREQEREBERAREQEREBERAREQERXnR/TsmfuyGa0zH4yqA+/flbtldh/sO3J50Q1gOyQe4Ac4BxYTD5HNWpK2Nr+M+KJ00rnPaxkcbfq573ENaO4GyRskD6kBaK7ma+CxrcN026Nth8IiyWUrueH3Hcy7i0k7bGNhum8efBrnDegJLOVbYxcHRfSNSVtSaZrrExb/1GRmGwHv1viwbdxYCQ0E/Vxc50JyOH6VsmPGVq2Yy0Q0+9M4SVYZNOB8Fg7SFpLSJHEtJB9Lm6cQsOlsazpezT6w6p4xxwOZap44yhtq87Z4ab3LYiWu3IRocSBt2mnFZfIW8tlbeUyEvjXLk77FiTiG85HuLnHQAA2SewAC+ZK/eyd193JXbN21IAHz2JXSSO0A0bc4knQAA/wAALmQEREHbhMXkM3la+LxVWS1csO4xxM+p7bJJPYAAElx0AASSACVo8xep9N0Zun+n7TLFiUcMnlIif9/6HwYj9RECP8F5GzrTWtkzVWt0VTfimSR2Oo5mcbs8bg9lJrh3gjI7F5B094/y1vbbn1vR3TU+emnsz2GUcVSZ4t+/NvhAzev6dySSAGjZJIABJAQcfT2FtZq4K8D68EQI8WzZlbFDCCQ3k97iA0bIHf8AqQr3JdUVsJX/AJP0S+WqyGdkrs1HJJDbsvaHA8SHDhEeXZpHI8WuOieIrOq85WutZisLXkp4Os7cMT9eJO7uPGm12LyCdDZDAdDe3Odn0BERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFY0/2zPv+VXKxp/tmff8oOS5+5f9vwoVNc/cv+34UKAiIgIiICIiAiIgIiICIiAiIgIiICIiAiLWdM4TGUqtfqPqwsfjHsMlOhFOPGyDmvczgeJ5RRhzDycdOI0G/Xm0OPpTBVrzJMtm7ElLB1X8ZpWa8Wd+t+DCD9Xnts6IYCCd7a13rqbqCTNWBWo0a+Nxkbv+loVWcWM9IaHO/q+QhrdvcS467krn6m6gv5+zCbUrhWqwsr1K/MuZBExoa1jdk/RoA2SSr/H40dIYGLqbKyRx5m0xr8JRkjEhI5d7MjSdBgAPHew52vS4NfoPeUZ/oHCuxb6sEvUWXpbsSScX+QrSAjww3vqV7dklwHFjwRsuDm4NS27E9u1LatTyz2JnmSWWV5c+RxOy5xPckk7JKiQERdeHxt7L5KDG42u+xandxjjbof02SSewAAJJOgACSQAghqV7Fu1DUqQS2LEz2xxRRMLnyPcdBrQO5JJ0AFs5I8X0ZjYXMfBkeprEUU7XmORoxLtP2wbcA+XTmbLmjw3s9JOuS5/O1ejW2auHuVr+bk5wy5KuSY4Iz2LYCQDtw/VJ2OjxGhyL6jp/Ey5m3K+ay2vUhaZbluYnhCz6cnH6kkkAAbJJAAJICD1gMNez9+bgJDHFHJZuWCxzxDG0Fz5HaBPYAn6bU/VHUQv0q+DxUb6eCpu5RQHs+xJrRnm12LyCdDuGAkDZLnO+Z/qLxa78NgfM4/Ba4GDxNPt6cHeJPo6ceTWkN7tZoa2dudnkBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBWNP8AbM+/5VcrGn+2Z9/yg5Ln7l/2/ChU1z9y/wC34UKAiIgIiICIiAiIgIiICIiAiIgIiIClqVrFy3DUqQS2LE8jY4oomFz5HuOg1oHckkgABd/S+CvdRZePHUTDGSOc087+ENeMfqkkd/xaNj+5JIABJAOqoyu6ex846QqS5PIxB4tZ2GrKBAx7Gh0UWyQ0Ah/+4WtcWvIIAJCDipV6PSEEd3JQRXc+8O8PHzwskr1WOY5hM7HtPKT1BwaP0Fo5bO2tzuYymQzGQlvZG1LasyuLnySHZJK5HvdI8ucSXE7JP9VrcLSx3TuNi6h6hrNt2Zmk4zFybAn/AKeNL/URA77di8jQ1pzmh4wlen07Qfm81E912WF38opkN26QggWJA4HUbDogEetw4jtyLc9nctkc5l7OWy1p9q7ZfzllfobP0AAHYAAABoAAAAAAAC85fI3ctkpsjkbDrFqZ23vcAPoNAADsGgAANGgAAAAAuRARFtKnS9Pp+pHlOtRNBYExEOCLHMnna3ezMdh0LOQA1rk4ctcPS4hWdK9IZfqGKa5CIqOLgDzPk7nJlWNzQDw5hp288m6Y0F3qBIDQSO7N9QUKGMbgelYBBWa1zLWRfGBavE6LuR7lke2t1GDoaBO3bcavOdRZHK1q1GWUQ4+mzhVpw7bDAN7IaPrskkknZJJJJJJVdQq2L9yKpUhfNPK4NjjY0kuP9gAg6+nMNezuTbTpMG9F8sr3BscMbRt8j3HsGtAJJP0AVh1flMX5Kr090+Hvx1N7ny3HcmuvzHt4hYewY0bDARyAc4nXLi3q6nsRdPYmz0XUjcLwsj+c2tuZzkjJArhvbbGO2SSDt7RrQaC7IICIiAiKWpXsXLUNSpBLYsTvbHFFEwufI9x0GtA7kkkAAIIkVy3pXqTzkVSTB368sr2xt8zA6FoJOhyc/TWj+5JAH1JVuP4a9WF4aIsPsnWv57R//cgx6LryeMyWLkijyePt0nzRiWJtiF0ZewkgOAcBtuwRsdux/suRAREQEREBERAREQEREBERAREQEREBERARduOxGVyMFixj8ZduQ1uPjyQQOkbFy3x5EDTd8Trf10f7LSv6DbE+OGz1j0vXsOa0viM07zE4jZa5zIXM2PodOI7diR3QY1Fa9VYDIdN5Z2PyAjdtokgsQu5Q2YiTxljd/wAmHR/sQQQQCCBVICIiAi3eYZiOi5ocNN05Wv5+m9sl6xfe57Iph3MLY2SCNzGEaPLlyPI/Qhok6byb88zOVLPTWEmgOKtTl9fGsidWdHE57JGvYAW6c0bG9EHR2CQgwCIiAiIgIiICIiAiIgKxp/tmff8AKrlY0/2zPv8AlByXP3L/ALfhQqa5+5f9vwoUBERAREQEREBERARduIxOVzE8lfE4y7kJo4zK+OrA6VzWAgFxDQSBsgb/AMhaF/8ADfrEWZKzMbXmsRtc4wwZCvLI7iNkNa2Qlzu3ZrQSfoASgyKIiAiK3wvTOfzFY28dirMtNr3Mfbc3hXY5reRa6V2mNOiOxIPcf3CCoWkwHTtZ+PizvUN1tDEGXiyNp/6q4BvkIWkEaBAaXu9IJOg8tc1ajCYTEYt0kmHhg6iuxM4WMjkGRxYqpzDW8miU6eQ4ua10mgeQPAOAI5+qc3iMbZukZGx1P1OZPVlXOY6nA9rmOJia5rvH2PEYSQ1o7ObzBBQTZC5HJg3Ovxx9P9MRudNRwdWd3j3XPJ071Euc3bCDM/YaGBo2Q1hssp1RlOmehDUdLSrWs/RrtgxtF7/Bo0wC8PcOZD55SWu27k5rdDkNljc5Tgv2C7+I/V0rbEb7HOnBYjaf5lKw/pEZHEV2ceLu3HQ8No7OLKnH1c9171kyGPxr2SyE/qce57nuT/gD8IJeiMZRkfZzeZe1uKxrfElY55b5mXRMddpAJ5PLSNgHQ249gSKXP5Sxms1bytoMbLZkL/DZvhG3/ixnIkhjRprRs6AA/or/AK8zmPmr1Om+m57DsFjxtz3jiLtnvzsFugQNHiwO2Q0E6aXuaskgLrxGOu5bIw47HV3WLMx0xgIH0GyST2a0AElxIAAJJABV1gOk5rdOtl8zYOJwVh0rG3SGPe5zGkgMhL2ueC/TOQ7A77+khbGWuIOkrEeOkk6V6UkL5jLdlY6/l3sPpaA0AvLebWgNAY3lydrbnEK/p2nVwtx1PARU851JA98zsr4jvJ45jA71x8tB2h6zI8ekhvENLeTs51th8jjLkNm/lK+U8818jLcE5lZLwlfE4hx/V6o3AEdjrYJBBWlo3cdk8JJjKFW1iOjqMzXZq22aM3b7j4joWuBI0HeGAGND2sd63F/Fmsl1dnp8/lBO9phqwRMr06weXCCFjQ1kYLiSQAANkkoKZrS5waO5P0W5iysPQmNfWxLw7quwwssXWHYxjD9Y4j/65/q4f9veh6+8fP0zDV6cwn+rclBK+xN4kOEiDAQ6w0DlM4uBbxiJaeJB5Ega1yc3I2rE9u1LatTyT2JnmSWWR5c97idlzie5JJ2SUESIiAu3B4rI5zLV8Viqr7V2y/jFEzQ322SSewaACS4kAAEkgAlWeH6akmxjczl7QxeIe2TwpywSSTvbocYouQLvUdciQ0cX9y5vE9mQ6qdFQlwvS9Z2HxczmGZrJOU1pzW8Q6V577+p4jTQXO4tGygnixPTPTbpR1LI3N5BjoXw08be1A36mWKd4jO/+Lf9p3u076FesX1FnZobuJ6QqNwlOcmxaZTleHcWNPqfK53Li0bOidDbj22dwY7pirVx7cx1dffjabyx0VWLg+7aa4kF0cRd2aOLtvfpvpI3sgHmz3VklrGPwmFptw+FeIzLWY8SSWHs2ecsvEF3qO+IAaOLPSXN5ELWxF01gvBlz+Qd1VkHyAy0aF5zYYmcQ7k6xxcHOOwOLOWtO5FpAB7sYOieq7Nihiejr+EdFTntPunLvssgEcbnDk0xt7OfxZskd3j/AMGmwfStWrjX53rM3cdjjEHU6sbQy1fc5u2Oj5ghsQBDjIQQ7sG724shtdRXbuMh6cwlGKhRcGMfBXY0y23N2Q+WQDlI7bna2dDkQ0AaCDs62Y5vQHSD7UkL7b/OcdkGby4dGI+X/Lhz8bjvtvnr+qxS0/8AE2S//qp9PIWRNJRrQVgxkvNkHGJpdG3uQ3Ty/bR9HF2++1mEBEVx0z0xnupZpY8JjZrTYBueXYZDCNOI8SRxDGbDXa5EbI0Nnsgp1fdPdK5LMY+bKiSpQxUEhikv3ZvDiEnEu4N+rnu+nZjXa5NLtAgrWdKdMY6JtWWpjZ+oM1WDrVsyPjbiqrA3epHO/Xw0XOJIYda05oJdYZVmKykeXmzGbly8WHg8B89aeOGlDIWagirRhu5Rya4bAYxoj2C4FuwzsXVlXpaxHH0TVigmhZxflp4w61O7TgXs3vwAQ9zeLCNt0HFxG15h/ij16y0yZnU+SMgcCAZ3EE/+N6WMd3d2+y1vTceO6arRdSZuuy5ZI54zGvPpncN6ml0diJp/p2LyOI1pzmg/ixSxNLP0v5bX8pYs4yvayNVrCyOCzI0vIjbocWOYY36GwC8gaADW49SWZ5rNmWzZmkmnleXySSOLnPcTsuJPcknvtdeCw2Uzl4UsTRmtzaDnBg9MbS4N5vcezGAuaC5xAG+5CDgRa6lhem8bUe7qO5ft5Bwe1tDFOjPgEEcXSTHk07Ad6Wg9i08t7avU3W9upjIcd05Rp4OFlc15J68TPNWWkhzvEm1zdtwB1viNAAAAABzSdC52uXR334rH2PBbLHWt5KCOZ/It9HAv2x4Di4iTjoNcD6tNNNncTeweUlxmSjjjsxNY5zY5mSt09ge0hzCWnbXA9ivdGrey9/w4i6aUguc+SQAMa0bLnOd2AABJJ7dlc/xLsUzl6WJo3Ir8WHox0XXIZecdiQOe97mHQ9IdIWAjYPDkCQ4IMqiIgIu3B4rI5zLVsTiqr7V2y/hFE3Q2fqSSewAAJLiQAASSACVpJaWC6Ulrvsyx5zNxhsklUNaaVZ/q9D3d/GI2wkaDNtIPiNPcKTpvpvOdRTSR4fHS2RFrxpSQyGHYcRzkcQxmw12uRGyNDZV1H0HMynJNkuqelcZMyQs8tNkfFkcNA8h4DZG67kd3b7Ht9CYXZHq3q6cRCzPPFXi0GNc2GCvC1v8AjixjGtH+AAF0QWOlOmr8jbNM9U3oQ9mxOI6LZA0cTsAvmaHbB0WA8fS4ghwCLqvNwsxWM6awdqUY2lADYLToWbT+8sh0G8xvTWlw2GNYD9FW3um8zT6bp9RWajmY664tglP0eQSDr7gq5zNajmuhKfUNIn+ZUX+WzTBXbExpe9xgkbxAaQ5m29tHcZ2O4LuPpgZjqrK4TpI3HvrmcR1onEBrNkk//lB566rWq9Lpc2eWpsJHJFv2GeYD5BWZV11zl62c6qvZGjX8tTc5sVWPjxcIY2Njj5Dk71ljGl2iRyJ12VKgKx6aw9zqDPU8NQaPMW5QwOc1xbGPq6R3EEhjWgucQDprSf6LowvS+ezGPsZGhjpH0KwPi25XNigaRx23xHkNL/W08QeWjvWls6WNnr07mJ6Ne9tB7+GS6ivBlRssReAxgL3kRxb4nQcS52tk6aGhR/xhy9HO/wASs5lMcQ6rPbkdG4f8hyPf7qbGZXF2f4fTdM+dkxF6S0yV8pbuG4wf8JXBvNoafU3RLdju0ni5kMmcw3T0bGdLiW1lY5g9+VswxuiIbzBbHC9hJa70OD36d2I4hWWTnyWd6Fu9R9VwVRLPNHHibLYY68kvHmJQ2ONgDo9loLyQA5vFvI8+IZbqnp23gJ4PEs079SyznXu0pDJBNoDk0OIBDmk6LSAR2OtFpNMtZj9f/TPN+fdfNcXqvkBFx8PzOpN+Jvvx8LxPp35cf6bWTQEREBERAREQEREBWNP9sz7/AJVcrGn+2Z9/yg5Ln7l/2/ChU1z9y/7fhQoCIiAiIgIiIC0PTfTL8ljLebyFo43C1CY32zFzMs5btsMbNjm76E9wGtOydlodnltck2TJfwvwkmMg/wBjEyTxZMMa0HxnyF8crwDs7j0wOdonwi0dmoODI9UTfy92Gw0LMZiuLWPjiaBLZ4706Z/1kdtziN9hyIaANBWPQ0MOAx7uu8h5Z5pyhuKpTPc3zlkOB2A3uY4/1O+gPZvIFzVjPDfw58Tx+m9dlssBlcVlsFjums9jsragx0liamcdYZG8um4cw7lG/l/2261r+qDEq7wvSubyjqUjKUtWjbcQzIWmOjqhrSQ5xkI0QOLt62djQBOgt1jcecRlMccV0/iumslD/v1b/UOVAmeC53GXg/jH6TsNcGDRYD+obVT1Bk8HIK+SzXU17rG7PMTPThlngjiYB9TJKzeySNBrT9HbI7BwQYPCdP1MlHEGz9ZXix7DQpQTR1xISQ0mQFsjwG99AM9Wu5AIdcdTZDEUIr1fqXwJcrHK90OAxNZtelUsaYOU7m6G9fVrATuMscWHuMlk+scrYpw0ccyDB02V3wSQY0yRCw1/Z3iuLnOk2NN0Tx0OwG3bziC26hz+QzjoGWvAhq1uYq1K0Qjhga52yGtH1P0HJxLiGtBJ0FN0TiqGVzRGXsy1cVVhfZuyxFvieG36NZyP6nOLGA6drly0QCFRrZ5GhLh/4VYex/ttOftzWHuY9x5xQu8KNrgewLXiY9vqHjZ/oApepsu7L32thrsqUIB4VKrEPRDHvsBvuSfqXHZJJJJJJVnmHt6c6a/0+xnHJ5FrJcp4tbToofRJBE1zu4J7PdoewB362rp/hbSqWrmRl1BNl4Khdiq89iKFklgua1riZfQeAc5/F3Z3Dj/Vex0lFVyAyHXPUlKBjrLnXK9S625emGuRcCzlGC9x1yc7YO3FrtAODH46jdyNtlPH07Fyy8EshgjMj3AAuOmjudAEn/AK2uHwMGDy4puqU+qM+9gEWPgjfNBVk2xwc9zSGykaewsAcw73tyt61WnXx8uRgrf6O6dlrhj7LrDpL2TbHx22IOI5ucXMLms4sBLS7i1oIyuX6xkfjP5T09jo8DQIPjGGZz7NkOZxc2WY6LmHb/Q0NaQ71BxAIC7v5TEYCyy5k30uqeoImQeXgaWvxlSPW+BdG4eIQ0NAYzTW8u7ttLFhszk72Yyc+SyVl1i3O7lJI4Af00AAOzWgAANAAAAAAAAXGu7p7KWMHn8dmqjIn2MfaitRNkBLC+N4cA4Ag62BvRCC/wCuW/yNkPRta5HZjx0j325IS7w5rTtB7gHH6NDWsB0NhgOgSVTdN4i3n85UxNGMyWLUojYAP7n6qw/iLj/I9XXTFKZ61twuVpi0t8SGUCRjtEAjbXNOiNrl6Qz17pjqKnnMcWixVkD28hsH+4/9kEnXOUgyeabFSc12Ox8DaVJzW6D42b3J3a13reXyacNjnx/oFQrdYWXp3J3bNXD/AMO7GRt23h0ML8pK9tbuTxjDAxxb3A9ZefSO/wBd8fU1Xp6Dp1xgfiI8z5yLVejNPNxgMTi4mRxMZ9RYNAkg9v6FBkVsem6OKwOHg6rzrIL005ccTjHae2VzXFpmnH/ptcCAw/rI9XpGn45brJxz9dY3EWca6KbL0KEWOnx7DxkeyBhEcsbS4mQeGzbtdw5riQ1pbsMnlclbyls2bcnJ3EMY1oDWxsaNNY1o7BoAAAHbQWw/hlg7ckFnqav01Y6lfTeIq2OghdNymc1xa+VrNu8JnHZ19SWt23lyGGlifFI6ORpY9hIc0/UFaHpbG9YSQ2LXT7cnDBHG6SxPXkdExjGjbnPcOwAAJJP0QWVzp3N5i5c6h65zEeFkdZYyf+YRSC1INDfhQNb+ljeIAPBn0a06aePMcr0xhqEdfD4WHKZBj3l+SyUZLXNcOIDK/IxgAe7keRJ2PSGzHpqAwHLdS9YYhsJJDm17wu25HcS4NDGb+vHXJxa0EjbhtfMZ/ovJS28PWxc8M8jJjTymQyjYGN4Mc5nOPjxBdxA1zOi7QJ/qFBduZfqXOCW3Ynv5G3KG83nk57idBX77+M6QpBmCyEeQ6ilBbLfhaRHjwCQWwuP65Tof7rfS0aLCXHkyu6XyNjo7rWpftUg6fH2AZa8rfoQe4O1cUsN/DqfKNMOZ6jvQvc4tx0VBkc2jvgzxy5zSR22fC76Og3fYMIrnpzprLZ2eAVa/g1JJjC+/YBZVhIAc7nJrQ00g6G3HYABJAO6mxmBxkIjk6ew2Es4+Rkkk+cykk9twc4OYXVWNAeNOb6fC0W9yCNlc/V/WOJ/nMs8lq11ta4skZcvTzRVGSE7c1sHpe5ob22Sz1b7EAFwe+keh8ZJkmQ169rrS4WSRmrTrzQ0mS701zpzxc9ob30Az1a7kAh3zM9SYeoL1XIWa2Re175YcVh6rIMW2xvgS97SOYAaDtjSHgNAeN7bjepuqczn5p/N2TDTkmEzMfXJjqQkAtbwi3oaaSN93HZJJJJNIg0013NddZ/H4pja1ePxHR1KteDw61ONx5PdxYCeLWjbnnk7iwcieIUfVmUglFfC4vg3FY8FsRYwt8xIQA+dwJJ5v4gkEnQAaOzQF3YSCTE/w6vdRtr1nzX7/APLK0+z4tcMj8Sbj/wARyD4wHDbtB47Anlkdn/CDS9G4qlOLeazMjI8Vj2F72OkLHWpdeiuwgE8nHXfR0NuPYErjvPzXV+duXq2KfYn8MSPgx9UlkELA1jQGtBIY0cG7Oz9Nkk7Nv0+MvN0pNUkwbLeGjsCw+aeeSGCKQgRhz3Ne1p+vEF29ciBrkd6TN5ZzsS6HqTrLHxVYoDNTwXTr/wDakLnn0Hwm+DF6tuds7A2eLiQCGfr9L4zCZeCPN24s5abwecTii+QvJaSY5JQABo8QfD57HLTm9nK3zL62Osx0erHxYCo9kPi4XC0mmw6INdwdMXOb6wO+5Hl55h2iHbVXWz+Uy2So4L+H+Gfg3ulD4vKWnOtyODPU6SwS3TG6e7sGNaDt2+IcFa3hejKUXlIYcn1WHiU3C/lBjSAQGRAHjJIN7LzsNcG8P083BaS513TNCeJ/T2Pwtl/jQ16ElXnbLHHjysySDk3gAeIYIy4kuIDeIdhcDh8lncrBjMXUltWpnhrGMaT9f6nX0H+V39PYTJ9WZeWR9qKNgcH3chdnEcMIc4N5SSOOhskAb/qQF1dX5nFQVndOdKc/5Uxw8zde0tlyL2n9RB7siB7tZ2J0HO78WsDo6myOJwOEsdI9PvrX5Zy0ZbLNaHCYteHCGA/+m1zWkvHd5aOJ4jb8Wi0WE6Us3MfDl8lcr4nESPLWWJ3AyTcXAOEMQPJ5Gzo+lhLXN5AhBnVp6PR9iJssvUliTAsjkMXgTVZH25HcSfRDoHW+ILnFo9XbkQQNpFDiOmRFkaUP+lIXQPEN23YdYytuJ/Mh0UTQ1rNhroxIGsb/AMS71HfP0z1x05V6mNWClFRxk8c4s5XKMdbtzOEUoiJADhEC4xEtYHEFv6y0lBncn1bBWqS4vpPExYWjIzwpptl9yy3TeQllJ+hLGuLGhrN9w0Kr6NwFjqTPQY2GRkEZ2+xYkIbHBE3u+R7j2DWgbJP0XJnMfaxmQfBaYGkgSMc0hzXsd3a5rh2IIIII7FXvT2TxkvSWR6ZuW3Yt1qZk7bjIjIJfDbJxgeGkERue5jifVoxg8SQEHF1hnqeQMeMwVJ2PwdY7hhdrxZ360ZpiPq87Oh9GA6GyXOdy4LpzI5WvJdAZTx0XMSX7Ic2AOaAfDDgCXPPJvoaCfUCQBsi5x1boTFU2T5Sze6gyIe1wqVSa1QcXHbHyFpkeHN4/pEZb6gCexVvmoLWQx9a51RZq9PYanVP8qw4e5skzdPLBGxoLtPexwM7hrkSXEk9wjYY8l0+/pzpyAY/p6rq1l8vaYQbL2nQkkI+g2dRwjv6iByc4l3HH05xsOyXQmdfnJaG5JWQ1Hw2IQHlokbGe72HQPId2h7A4NcdKg6h6gs5MGnXD6OHjeHV8eyUujZx2Gud9OcmnO28jfcgabpoq6lixTtw26k8texA9skUsTy18b2nYc0juCCAQQg22Qr9O9Q5YW8m+30vZdCxlitVwwfCXsaGl7GMLOAIAJGj6uR330Lnpjoak85GSlg7/AFHC2vzjt5OGTG06rRtzpXuEmzoD6l4aBy2D2LcFJ1R1LLN40nUWXfL73XZC7/32uTLZXKZeeOfK5K5fljjETH2Z3SuawEkNBcTobJOv8lBts11FgoK4mElLNWnzNsxUKuPNTGV3Hs/kwcHPfpjRoADRB5HjxOMzuYyObuNt5OwJpGRtijDY2xsjY36NaxoDWj6nQA2ST9SSuBazAU6GBxtTqfNV4L0ljb8ZjnkOZLxe5hmmHsa5rgGH9Rb6vT2eHRh+nMVhsVU6h6yklDLBEtLDxtIluxaJD5HggxRk8df8nt5EcAWvMNyfKdcZqbI3poalKtGA+Xw+FelXaA1rAGjQAHFrWN7k6ABJAUFSLNde9XSOs3GS27POexZtS8I4mDu97nHs1jRsknsArbJ4nJdQSNwvRNO1a6aqzFkdySPy0Fiw2MGSSSWQhoPc8A8tIYW+lrnuBCj6l6iN3HwYHFtkqYGpJ4kUB7Onl1ozy67F5HYDuGAkDe3OdnlsqfSGMx9qlN1R1Jjo6zpD5qnjZxZuNAJ9ILQYgXaGjzcGh2yCRxWmxOPw2DuQ369Wt02IJBar5LOXTNcEbjwa+GvGwB+iCQ4MJaQTscewY7D9EZe7VluZCSvgabIGTx2MoJIm2Gv7s8JrWOdJsbdtrS0AdyNt3pqHTWG6fhs5/wAM5bHRSxsrX8xRkrVWv5b7QhxdO46/R3bxDy5rh3bWXuuqkV+S5j8Q7IXuUrRkc3O6zIQf0PbFsRscO5LXeI3eh3AO8hlMnksrLFLk8jbvSRRiKN1iZ0hYwEkNBcTobJOvp3P90Gu/iDmsJJhIMDhrVbIlt11ye1DjBUgY50bQGwDYcAe4fyaNmKPWwAVhkRAREQEREBWNP9sz7/lVysaf7Zn3/KDkufuX/b8KFTXP3L/t+FCgIiICIiAiIgKwwGbyuAyDb+HvzU7A0CYz2e0ODuD2ns9hLWktcC067gqvRBrx/EzrcZGe8c2XvnjEb4X1YXVwBx/TAWeGw+keprQfr37ncd/+IvWtwQj+fz0/B5cDj2Mpk71vkYWt5fQa5b131rZWURB1ZXI5DLX5MhlL1q/cl14lizM6SR+gGjbnEk6AA/8AAC5URAREQFp8Dk8Ra6d/0zmuVNguGzUyEbC/wXyCNjxK0dzHxYHbYC4EHs7kOOYRBt8n0nhMJRr5Oz1ziLbLDBJDXxjnT2XNPHYLRoREB29Slh7OABIIUM3UuFwzyOk8XJLP6SMnl2MknafSfRENxt7h7Ty8TYII4lY5EHZlsrlMvNHPlslcvyxRiKN9md0rmMBJDQXE6GyTr6dyuNEQEREGrxPU+K/09BhuoenjlG03HyU9e0K0sTHOLnxuPhv5tLjsbAI2RsjQbO/qjpepQkZhuiY47zyQ2zkb3mhEC0jbGNjjHMEtILuTe2i07WNRBoL3WnVNyJ0Ls3aggfAa8kNQitFJGd7a9kQa12w4gkgkjsewCz6IgKWpZsU7cNupPLXsQSNkilieWvje07DmkdwQQCCFEiDYxfxN60Y+J5ydWWSJjWCSbG1pXuDRoFznRkuPbu5xJP1JJVFk+o+ocpRZRyedyl6ox4kZBYtySRteAQHBriQDokb/AMlVaICIiDQ2usc5eie3KywZSYxljLN2Fss7CXh5d4hHJ5+rfWXANcdAENI9x9ddVQUW06eWdQja8PDqMMdaTYBGjJE1riO57E6+h12CzaICIiAiIguMD1LmMHTuU8bPAyC66N1hktWKYPLOXH9bTrXN301vff8AopavVmaq2m2YH0WytOw7+XVz+WKiRBc53qnqPOxOgy2bv26zpzYFZ8x8Bkh33ZEPQzQc4ANAAB0NBRdMYK/1DlW0KIjbppknnldxirxDXKSR3fi0bH9ySQACSAYsFibWYveVq8GBrTJNNISI4Ix+qR5AOmjY+gJJIABJANvnczUr43/TvTxezGhwfZsPaGy3ZAP1v+umjZ4sB00E/UlziHTmcvi8GLWI6MlsugmaIreSn0JrQAG2tA/7cRcOQbsk7HJzuLdcfR/Tc2esTz2bDKOLqN8W9fm34cDN62dd3OJIAaASSQACSAocNgpLNGbMXXupYqAgSWHMJ8Rx3qOMbHN50dNH0AJJABI7upc4/Ovp9MdMULMGGinDadJjec9ud3pEsobvnK7eg0bDQeLdkuc4IOr+oochDFhcJBJS6fqP5QQv0JLD+48efR0ZCCdAbDAdDe3OdyYTpfPZmjYyGPxz30q4Pi2pHtihBHHbfEeQ0v8AW08QeWjvWlrOm+jKtWStHk6M+cz1pjvCwMDHgQcgAx9iRpBB7uPhAgg8eTv1MXzqHP4qrE1lyepnb8D/APYoVoBFiqf+44yN9BHi7I2AzTDz5czotIWHTWEq0fBn6XhbYyFMxvtdR5CVsNKjJsgOhD9N1t7QHSbdya1zQwnSrcp1nQxksk2Gks5rO+KHHN5BodHGWudvwIHAjTgGkOk76c4cAdOGV6j6mzfUMdKLK3BLDRjMdWGOFkMUQJ2SGRtDdntt2tnTQToDVOg6cnkL+UvSXsnds3rcmuc9iV0kjtANG3OJJ0AB/wCAFzIiDTYDqmKri24XOYiHNYtjy+FjpTFPWJDtiKTRDWlxDi1zXDsdBpc4nw7I9HGXkOm8uG7/AE/ziP8A/nWcRBs3dbVcY+u/pDpynh5oiHm1aLbthzhy2PWwRhh23t4fLbf1aOllcnfvZS7JeyV2zdtSaD57ErpJHaAaNucSToAD/wAALmRAREQEREBbezZb1rgaDJ8nVrZfC0mVAy5YjhZZrscRGY3O4tDmNLWFpOyAHAu27jiEQbofw+6ywd+ucoyHpySUuEM16/DW5cdcuJc8b1sb19NhS5zHVMVPB/qLr0ZPxNF8GHseckDDy9Rfy8IaLdFvLl3B1o7WARBq39YDHxwx9KY0YV3gPjsWZHts2ZnO7FwkLB4eh+ngA4HZ5HtxzuTyF/KXpL2Tu2b1uTXiT2JXSSO0ABtziSdAAf8AgBcyICIiAiIgIiICIiArGn+2Z9/yq5WNP9sz7/lByXP3L/t+FCprn7l/2/ChQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBd2FxlnLXRWrmONrW85ppTxjgjGtvef6NGx/ckkAAkgGz6W6YkytaTK5Gd+NwMD3RT5Dw2v1L4bnNjYwvaZHEhoIaTxDwT2I3L1N1MLuPgwWGrvx2BqkmKvyBfM865TSu0Och0Nn6AAAAAAAIs3lKsND+RYIvZjmO5TzuHGS7IB+t/8AYDZDWA6aCfqS5xn6U6fZYgd1Bm3Pq9PVJA2efXeZ+iRBEP8AlI7R7fQDZJABIm6Z6Qu24IcjboXp4p3ObSpVYy+1kHtbyc2JoBIa0d3v0Q0f3JaDqs7TZY6lmrdR42cvrzCLD9K43IieKDQYCZJGucGtc1gDvD057i53oAaCGRgh6j64nlcJYYMbQIe7xJhDSx7HlrfSCexIaOzeUjwwnTiCVqOnoMTgcG2/SsR0XNikFrOyPIsT7DQ+CjCSNkbDeY9WnuLixji1vPnsvWwNiLF52E5GzjWeFDhIJfDo0neomOVzfVI9r9F7QQSXO28PBWGz+byeeutuZW148rImwxgMaxkbG/RrWNAa0fU6AGyST3JKCw6k6mfkIhSxlZ+LxvhtbLA2cyPsv21znzP0PEPJoIBGmgDQ3tzs8iICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiArGn+2Z9/yq5WNP9sz7/lByXP3L/t+FCprn7l/2/ChQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARFLUr2LlqGpUglsWJ3tjiiiYXPke46DWgdySSAAEES1XT2EpY8R5rq+vYjoNa2StQ7xy5DYDm6+hbCQQS8fqB00725lhPjML0SyaLMNo5zqL0GOtHL4lWgfS4+LrQlk3tpZ3jAB7v5Djksvkr2WyE1/I2pbNmZxc+SRxcSfug6c7nLeV8CF4ZBSqs8OrUi7RwM+pDR9e5JJJ2SSSSSSVtuk+l+n8Ngh1R1jegIfE52PxrW+K6eQDbTI0OB4A8djbeQOtj6rA4bFZHMXmUsZTmt2HnTY4mFxP8A7LT8sJ03Wgu3LVPqLOtkb4dMPdLUrxgNdyke0gSEg6DGHseXIgt4uDZ5zqPM5+SXNNjwvQWHnj8sLTKois2YAWN4ekGWcD/b2Gg6ABOgNrD5PqjGUcJNh+lKdmB1ocb2UtFvmbLC0comtbsRMJ5B2nOLxobaC5pzOWyFzK5GfIX5jNZndye/QaP7AADQa0DQDQAAAAAAFyoCIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICsaf7Zn3/KrlY0/2zPv+UHJc/cv+34UKmufuX/b8KFAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBbFtiPo6hAcbMybOXajJpbYb2pxSsDhHHv8A5lrhyf8A5LR25F+OWhv9UyX6OPr3cLiJ5aUDa7bJhe2WVjBpgfxeGni0BoOgSAN7OyQqa1a7kLPCvDNYle76NBcSVqo+m8f0yWWutnvbPs8MPVkYbLjw5tMvfUMZ2zuQXEO21rgDrhl64zjcddxmNFHEY+7EIZ4KNRjC5mgHN8Ugy6dr1DnogkfpOlmEGlyvW2dt1zSpSswuOMbojSxnKGJzHNDXtedl8gdrZD3OA5O1oHSzSIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICsaf7Zn3/KrlY0/2zPv+UHJc/cv+34UKmufuX/b8KFAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAVjT/bM+/5VcrGn+2Z9/yggtQSvnc5rNg60djv2/8AhR+Wm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkJ5ab2fIREDy03s+QnlpvZ8hEQPLTez5CeWm9nyERA8tN7PkLsrjhC1r2eofX0k/gIiD//Z';

function generateHTML(data) {
  const {
    order_number, club, address, ship_date,
    payment_terms = 'Due on receipt. Based on our custom model, garments are produced specially for each club. Once clubs approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final.',
    w9_link = 'https://www.mayorclothing.com/w9',
    payment_link,
    line_items = [],
    subtotal, embroidery, art_setup, shipping, total
  } = data;

  const tableRows = line_items.map(item => `
    <tr>
      <td class="product-cell"><a href="${item.url || '#'}" class="product-link">${item.product}</a></td>
      <td class="desc-cell">${(item.description || '').replace(/\n/g, '<br>')}</td>
      <td class="num-cell">${item.quantity}</td>
      <td class="num-cell">${item.price ? '$' + Number(item.price).toFixed(2) : ''}</td>
      <td class="num-cell">${item.amount ? '$' + Number(item.amount).toFixed(2) : ''}</td>
    </tr>
  `).join('');

  const embroideryRow = embroidery ? `
    <tr class="fee-row">
      <td colspan="3"></td>
      <td class="num-cell fee-label"><strong>Embroidery</strong></td>
      <td class="num-cell strikethrough">$${Number(embroidery).toFixed(2)}</td>
    </tr>` : '';

  const artRow = art_setup ? `
    <tr class="fee-row">
      <td colspan="3"></td>
      <td class="num-cell fee-label"><strong>Art Setup</strong></td>
      <td class="num-cell strikethrough">$${Number(art_setup).toFixed(2)}</td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'EB Garamond', Georgia, serif; font-size: 11px; color: #1a1a18; background: white; padding: 40px 50px; }
  .header { display: flex; justify-content: center; align-items: center; position: relative; margin-bottom: 6px; }
  .header-title { font-size: 20px; font-variant: small-caps; letter-spacing: 0.12em; font-weight: 400; text-align: center; }
  .header-logo { position: absolute; right: 0; top: -8px; width: 110px; }
  hr { border: none; border-top: 1px solid #1a1a18; margin-bottom: 18px; }
  .body { display: flex; gap: 30px; }
  .left { width: 38%; flex-shrink: 0; }
  .right { flex: 1; }
  .left p { margin-bottom: 4px; line-height: 1.5; }
  .label { font-weight: 700; }
  .address-block { margin: 8px 0 12px; line-height: 1.6; }
  .payment-terms { font-size: 10.5px; line-height: 1.55; margin-top: 8px; }
  .payment-link { margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #1a1a18; color: white; }
  thead th { padding: 7px 8px; text-align: left; font-weight: 700; font-size: 11px; }
  thead th.num { text-align: right; }
  tbody tr { border-bottom: 1px solid #ddd; }
  tbody tr:nth-child(even) { background: #fafaf9; }
  td { padding: 7px 8px; vertical-align: top; font-size: 10.5px; line-height: 1.5; }
  .product-cell { width: 15%; }
  .desc-cell { width: 45%; }
  .num-cell { text-align: right; width: 13%; }
  .product-link { color: #1a1a18; text-decoration: underline; }
  .fee-row td { border-bottom: 1px solid #ddd; }
  .fee-label { text-align: right; }
  .strikethrough { text-decoration: line-through; }
  .subtotal-row td, .total-row td, .shipping-row td { border-bottom: 1px solid #ddd; }
  .total-row td { font-weight: 700; }
  .footer { margin-top: 30px; border-top: 1px solid #1a1a18; padding-top: 8px; text-align: center; font-size: 9px; font-variant: small-caps; letter-spacing: 0.08em; color: #1a1a18; font-weight: 700; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-title">Invoice</div>
    <img class="header-logo" src="data:image/png;base64,${LOGO_B64}" />
  </div>
  <hr>

  <div class="body">
    <div class="left">
      <p><span class="label">Order Number</span>: ${order_number}</p>
      <p style="margin-top:6px;"><span class="label">Club</span>: ${club}</p>
      <p style="margin-top:10px;"><span class="label">Shipping / Billing Address:</span></p>
      <div class="address-block">${(address || '').replace(/,\s*/g, '<br>')}</div>
      <p><span class="label">Ship Date</span>: ${ship_date}</p>
      <div class="payment-link">
        <p class="label">Payment Terms:</p>
        <p class="payment-terms">${payment_terms} <a href="${w9_link}">Here</a> is our W-9.</p>
      </div>
      <div class="payment-link" style="margin-top:12px;">
        <p class="label">Payment Link:</p>
        <p style="margin-top:4px;"><a href="${payment_link || '#'}" style="color:#1a1a18;">Click Here</a></p>
      </div>
    </div>

    <div class="right">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Description</th>
            <th class="num">Quantity</th>
            <th class="num">Price</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr class="subtotal-row">
            <td colspan="2"></td>
            <td class="num-cell"><strong>Subtotal</strong></td>
            <td class="num-cell">${subtotal ? Number(subtotal).toFixed(0) : ''}</td>
            <td class="num-cell">$${Number(subtotal || 0).toFixed(2)}</td>
          </tr>
          ${embroideryRow}
          ${artRow}
          <tr class="shipping-row">
            <td colspan="3"></td>
            <td class="num-cell fee-label"><strong>Shipping</strong></td>
            <td class="num-cell">$${Number(shipping || 0).toFixed(2)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3"></td>
            <td class="num-cell fee-label"><strong>Total</strong></td>
            <td class="num-cell">$${Number(total || 0).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    Mayor | 870 Inman Village Parkway NE, Suite 533, Atlanta, GA 30307 | 339-206-2111 | mayor@mayorclothing.com
  </div>
</body>
</html>`;
}

app.post('/generate', async (req, res) => {
  try {
    const html = generateHTML(req.body);
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    await browser.close();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="mayor-invoice.pdf"' });
    res.send(pdf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
