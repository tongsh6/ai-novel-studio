import Foundation

// 可执行入口单独一行 @main：核心文件保持无顶层表达式，便于行为测试直接编译同一实现。
@main
struct AxCuaMain {
    static func main() {
        runMain()
    }
}
