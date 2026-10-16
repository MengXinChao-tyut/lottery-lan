# 局域网扫码报名抽奖

手机连接现场 Wi-Fi 扫码报名，主持电脑管理名单、设置奖项并进行 3D 大屏抽奖。报名与中奖结果保存在本机，可导出 Excel；同一条报名记录在一次活动中不会重复中奖。

## 从 GitHub 源码运行

需要 Node.js 20 或更新版本。GitHub 源码不包含依赖和构建产物，下载并解压后，在项目根目录依次执行：

```sh
npm --prefix server ci
npm --prefix product ci
npm --prefix product run build
node launcher.cjs
```

完成安装与构建后，Windows 用户也可以双击根目录的「启动抽奖.cmd」。浏览器会打开本机管理页；默认端口 8888 被占用时会自动改用其他端口。

电脑和手机须连接同一个允许设备互访的 Wi-Fi。主持人在管理页选择当前 WLAN 的 IPv4 地址并展示报名二维码，确认名单和奖项后关闭报名，再切换至抽奖页。运行时不需要外网，电脑和服务窗口需保持开启。

详细操作、网络排查、备份与重置方式见 [使用说明](使用说明.md)。活动数据位于 `server/data/`，不纳入 Git；导出的 Excel 包含完整手机号，请妥善保管。

## 开发与验证

```sh
# 开发页面（仅监听本机，同时启动数据服务）
npm --prefix product run dev

# 根目录运行全部测试
node --test server/test/*.test.js tests/*.test.cjs product/test/*.test.mjs
```

不要同时运行开发服务与正式启动程序并写入同一份活动数据。

## 来源与许可

本项目基于 [moshang-ax/lottery](https://github.com/moshang-ax/lottery) 的 Vue 3 版本改造，基础提交为 `1590205`，保留 Three.js 抽奖运动和本地资源。沿用 MIT 许可，保留原有版权声明，详见 [LICENSE](LICENSE)。

---

## 上游原始说明（历史参考）

以下保留上游文档。其 Excel 导入、配置文件与演示地址对应旧版，不是当前扫码版的运行方式；请以本文开头和 [使用说明](使用说明.md) 为准。

# Lottery program

**This project has been refactored with Vue 3 + Vite**

Annual dinner lottery program, 3D sphere raffle, support for configuration of prize information, import participants information by `Excel`, and export lottery results by `Excel`
If programm is helpful for you😎😎😎, it will be greatful to comment us with⭐**star**⭐ 😘😘😘😍🥰🎉🎈🎃

[点击跳转至中文使用文档](https://github.com/moshang-xc/lottery/blob/vue/README-ZH_CN.MD)

> Try it now:  [https://moshang-ax.github.io/lottery/](https://moshang-ax.github.io/lottery/)

## Technology Stack

Front-end: Vue 3 + Vite + Three.js (CSS3D)
Back-end: Node + Express

- The front-end was refactored into components with **Vue 3**, and the build tool was migrated from webpack to **Vite** for faster cold start and better HMR
- The 3D ball is rendered with **Three.js** (CSS3D); to keep the visuals identical to the original version, `Three.js` and its helper libraries (`CSS3DRenderer.js`, `TrackballControls.js`, `tween.js`) are still loaded as global scripts from `product/public/lib`
- The data service is provided by **Express** with the same API contract as the old version (no breaking changes)

## Function Description:

1. The result can ben save and downloaded to excel synchronously🎉
2. The winner will not participate in the drawing, and the drawing person can be drawn again if he/she not on site🎁
3. Refresh or trun off the server will save the winner data and will not resrt the lottery data, only by click the reset button on the page can the  lottery data be reset🧧
4. The number of prizes is able to configure🎈
5. After all the prizes have been drawn, you can continue to draw special prizes(For example:Red pockets, additional prizes, etc). By default, one is extracted at once🧨

## Preview

> Try it now:  [https://moshang-ax.github.io/lottery/](https://moshang-ax.github.io/lottery/)

![lottery.gif](https://raw.githubusercontent.com/moshang-xc/blog/master/share/lottery.gif)

![index.jpg](https://raw.githubusercontent.com/moshang-xc/blog/master/share/index.jpg)

![start.jpg](https://raw.githubusercontent.com/moshang-xc/blog/master/share/start.jpg)

![end.jpg](https://raw.githubusercontent.com/moshang-xc/blog/master/share/end.jpg)

## Install
```
git clone https://github.com/moshang-xc/lottery.git

cd lottery

# Server plugin installation
cd server
npm install

# Front-end plugin installation
cd ../product
npm install

# Package (build dist output, used by npm run serve)
npm run build

# Running (Express serves dist, initial port 8888, auto-switches and prints the actual port if occupied)
npm run serve

# Developing & debugging (Vite dev server on 9000 by default, auto-starts the Express data service, ports fall back automatically when occupied)
npm run dev

```

## Directory Structure
```
Lottery
├── product                          # Front-end (Vue 3 + Vite)
│   ├── index.html                   # Vite entry page
│   ├── vite.config.js               # Build / dev server config
│   ├── public                       # Static assets, copied as-is on build
│   │   ├── img                      # Prize images
│   │   ├── css                      # Global styles
│   │   ├── data
│   │   └── lib                      # Global libs: three.js / CSS3DRenderer / tween
│   └── src
│       ├── main.js                  # App entry
│       ├── App.vue
│       ├── api
│       │   └── index.js             # Request wrapper for back-end APIs
│       ├── lottery                  # Lottery core logic (3D engine, state)
│       │   ├── engine.js            # 3D name-ball engine (Three.js CSS3D)
│       │   ├── store.js             # Global reactive state
│       │   ├── config.js
│       │   └── index.css
│       └── components               # Vue components
│           ├── ControlPanel.vue
│           ├── MusicControl.vue
│           ├── PrizeBar.vue
│           ├── QipaoList.vue
│           └── StarCanvas.vue
└── server                           # Back-end (Express data service)
    ├── config.js                    # Prize configuration
    ├── server.js                    # Service entry (auto-switches port when occupied)
    ├── help.js
    ├── data                         # Users / lottery result data
    └── cache
```

> 1. product is the Front-end page directory (Vue 3 + Vite)
> 2. Static assets under public are copied as-is into the build output
> 3. vite.config.js is the build / dev server config file
> 4. server is the data service directory, config.js is the prize configuration file

## Configuration Information
### Lottery personnel list information configuration
The lottery list information is in the **`server/data/user.xlsx`** file, information could only fill in base on the format, file name and title are not able to revise

### Prize information configuration
Prize information is filled in the **server/config.js** file, and the file name cannot be modified.

**The configuration of the prizes is described as follows:**

| Parameter | Value Type | Description                                                  |
| --------- | ---------- | ------------------------------------------------------------ |
| type      | Number     | Type of prize, unique identifier, 0 is the placeholder for the default special prize, other prizes cannot be used |
| count | Number | Prizes amount                                                 |
| text  | String |  Prizes name                                     |
| title | String | Prizes description                                              |
| img   | String | Image URL of the prize, image is under**img** catalog                |


```js
// Prize information, the first item is reserved and cannot be modified. Other items can be modified as required
// Prize in
let prizes = [{
        type: 0,
        count: 1000,
        title: "",
        text: "Special Price"
    },
    {
        type: 1,
        count: 2,
        text: "Special Price"
        title: "Mystery jackpot"
        img: "../img/secrit.jpg"
    },
    {
        type: 2,
        count: 5,
        text: "First prize"
        title: "Mac Pro",
        img: "../img/mbp.jpg"
    }
    ...
];
```

### The configuration of the number of prizes drawn each time

**EACH_COUNT**It is used to configure the number of lottery draws each time, which corresponds to the prizes one by one. For example, the number of lottery draws corresponding to the above prize configuration is as follows：

```js
const EACH_COUNT = [1, 1, 5];
```

Configuration above means the order of the number of prizes to be drawn at one time is：one special prize per time, one grand prize per time and 5 first prize per time.

### Enterprise Identity Configuration

This identification is used to display on the lottery card.

```js
const COMPANY = "MoShang";
```


## Docker Deployment plan

### Summary

This project is support to deploy by Docker. Docker is a platform with lightweight containerization, allows you to quickly deploy, test and run the applications. This text will introduce how to deploy the project by Docker.

### System Requirement

Before you use the Docker to deploy the project, you need to ensure you have download below software:

- Docker (Please refer Docker official file to get the installation instructions)
- Docker Compose

### Installation

1. Download and unzip the source code for the project

2. Access the project directory after unzipped the file

3. Execute the following command to build the Docker mirror image:

   ```
   ./build.sh [TAG]
   ```

   It will use Dockerfile to set up the Docker mirror image named `lottery:[TAG]`. If no tag is specified, the 'latest' tag is used by default

4. Execute the following command to run the local container:

   ```
   ./dev.sh [TAG]
   ```

   This will start the container and deploy the application in the Docker container. You can test loacally to ensure all running fulently.
Please be pay attention that all applicaiton in the container will monitor port 8888 and port 443.

5. Execute the following command to tag the Docker mirror image and push it to the remote Docker repository

   ```
   ./tagpush.sh [TAG]
   ```

   It will tag the Docker mirror image and push it to the remote Docker repository, please build up your repo at https://hub.docker.com/ if you want to us Docker official hub.

6. Ensure it has a file named `docker-compose.yml` and add below information:

   ```
   version: '3.8'

   volumes:
     lottery_log:

   services:
     lottery:
       container_name: lottery
       expose:
         - 8888
       ports:
         - "28458:8888"
         - "443:443"
       volumes:
         - "lottery_log:/var/log"
       image: "panda1024/lottery:[TAG]"
       restart: always
   ```

  Kindly take note that `[TAG]` should be replaced with the name of the mirror image you pushed to the Docker repository

7. Run the following command in the project directory on the server to deploy the application using Docker Compose:

```
docker-compose up -d
```

This will start a Docker Compose stack and deploy the project into it. Note that port 8888 and port 443 of the container are mapped to port 8888 and port 443 on the server. If you wish to use a different port, please change the `docker-compose.yml` file accordingly.


## License

MIT
