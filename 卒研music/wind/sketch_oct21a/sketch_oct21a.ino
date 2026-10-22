
#include <Servo.h>

Servo servo_5;
Servo servo_6;
Servo servo_7;

// 初始充气5秒
const unsigned long PRE_FILL = 5000;

// 风声音频19秒
const unsigned long WIND_LENGTH = 19000;

// 最后5秒连续抽气
const unsigned long FINAL_DEFLATE = 5000;

// 充气
void inflate(unsigned long ms) {
    servo_5.write(180);
    servo_6.write(180);
    servo_7.write(0);
    delay(ms);
}

// 抽气
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

    // ① 初始充气5秒
    Serial.println("INITIAL FILL");
    inflate(PRE_FILL);

    // ② 开始播放风声
    Serial.println("PLAY WIND AUDIO NOW");

    // ③ 风声前14秒：缓慢起伏

    // 第一段：轻风经过（2.8秒）
    deflate(1500);
    inflate(1300);

    // 第二段：风逐渐增强（2.5秒）
    deflate(1450);
    inflate(1050);

    // 第三段：风持续流动（3.5秒）
    deflate(1900);
    inflate(1600);

    // 第四段：风逐渐减弱（3.2秒）
    deflate(1750);
    inflate(1450);

    // 第五段：延续柔和起伏（2秒）
    deflate(1050);
    inflate(950);

    // ④ 音频第14秒开始
    // 持续抽气5秒，不再充气
    Serial.println("FINAL SHRINK");
    deflate(FINAL_DEFLATE);

    // ⑤ 自动进入下一轮
    Serial.println("NEXT WIND CYCLE");
}
