
#include <Servo.h>

Servo servo_5;
Servo servo_6;
Servo servo_7;

// 每轮初始充气5秒
const unsigned long PRE_FILL = 5000;

// 音效播放20秒
const unsigned long MUSIC_LENGTH = 20000;

// 最终连续抽气3秒
const unsigned long FINAL_DEFLATE = 3000;

// 前20秒：抽气45%，回充55%
const int OUT_PERCENT = 45;

// 气泡破裂的时间点（毫秒）
const unsigned long pops[] = {
    580, 2040, 3530, 5510,
    7400, 9400, 11230,
    13050, 13550, 15920,
    16680, 17520, 18080,
    18620, 20590, 21490,
    22490, 23550, 24220,
    26080, 27120, 27860,
    28400, 30370, 31370,
    31770, 32690, 33040
};

const int POP_COUNT =
    sizeof(pops) / sizeof(pops[0]);

void inflate(unsigned long ms) {
    servo_5.write(180);
    servo_6.write(180);
    servo_7.write(0);
    delay(ms);
}

void deflate(unsigned long ms) {
    servo_5.write(0);
    servo_6.write(0);
    servo_7.write(180);
    delay(ms);
}

void setup() {
    Serial.begin(9600);

    servo_5.attach(5);
    servo_6.attach(6);
    servo_7.attach(7);
}

void loop() {

    // ① 每轮开始：充气
    // 先充气4.42秒
    inflate(4420);

    // ② 提示播放音乐
    Serial.println("PLAY AUDIO NOW");

    // 音乐开始后继续充气0.58秒
    // 初始充气合计5秒
    inflate(580);

    // ③ 第一声气泡破裂时开始动作
    Serial.println("BUBBLE START");

    // 直到音乐第20秒
    for (int i = 0; i < POP_COUNT; i++) {

        if (pops[i] >= MUSIC_LENGTH) {
            break;
        }

        unsigned long nextTime;

        if (i < POP_COUNT - 1) {
            nextTime = pops[i + 1];
        } else {
            nextTime = MUSIC_LENGTH;
        }

        if (nextTime > MUSIC_LENGTH) {
            nextTime = MUSIC_LENGTH;
        }

        unsigned long interval =
            nextTime - pops[i];

        unsigned long outTime =
            interval * OUT_PERCENT / 100;

        unsigned long inTime =
            interval - outTime;

        // 收缩
        deflate(outTime);

        // 回充
        inflate(inTime);
    }

    // ④ 音乐第20秒之后
    // 只抽气3秒
    Serial.println("FINAL SHRINK");

    deflate(FINAL_DEFLATE);

    // ⑤ 自动进入下一轮
    Serial.println("NEXT ROUND");

    // loop() 自动重新开始
}
