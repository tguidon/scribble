// Keep one connection to the selected simulator's digitizer for the life of a preview.
// Wire format follows AXe's MIT-licensed DTUHIDModels and FBSimulatorDTUHIDTransport.
#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <mach/mach.h>
#import <poll.h>
#import <xpc/xpc.h>

@protocol SimulatorServices
+ (id)sharedServiceContextForDeveloperDir:(NSString *)path error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
- (NSArray *)devices;
- (NSUUID *)UDID;
- (mach_port_t)lookup:(NSString *)service error:(NSError **)error;
@end

static const char *service = "com.apple.coredevice.feature.remote.hid.digitizer";

static xpc_connection_t connectDigitizer(NSString *udid, NSString *developerDir) {
    NSBundle *framework = [NSBundle bundleWithPath:@"/Library/Developer/PrivateFrameworks/CoreSimulator.framework"];
    if (![framework load]) return nil;
    Class<SimulatorServices> contextClass = NSClassFromString(@"SimServiceContext");
    id<SimulatorServices> context = [contextClass sharedServiceContextForDeveloperDir:developerDir error:NULL];
    id<SimulatorServices> set = [context defaultDeviceSetWithError:NULL];
    xpc_endpoint_t (*endpointFromPort)(mach_port_t, uint64_t, uint64_t) = dlsym(RTLD_DEFAULT, "xpc_endpoint_create_mach_port_4sim");
    void (*enableSimulator)(xpc_connection_t) = dlsym(RTLD_DEFAULT, "xpc_connection_enable_sim2host_4sim");
    if (!endpointFromPort || !enableSimulator) return nil;
    for (id<SimulatorServices> device in set.devices) {
        if (![device.UDID.UUIDString isEqualToString:udid]) continue;
        mach_port_t port = [device lookup:@(service) error:NULL];
        if (!port) return nil;
        xpc_endpoint_t endpoint = endpointFromPort(port, 0, 0);
        if (!endpoint) return nil;
        xpc_connection_t connection = xpc_connection_create_from_endpoint(endpoint);
        if (!connection) return nil;
        enableSimulator(connection);
        xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
            if (xpc_get_type(event) == XPC_TYPE_ERROR) _exit(2);
        });
        xpc_connection_resume(connection);
        return connection;
    }
    return nil;
}

static bool barrier(xpc_connection_t connection) {
    xpc_object_t barrier = xpc_dictionary_create_empty();
    xpc_dictionary_set_bool(barrier, "isBarrier", true);
    xpc_object_t reply = xpc_connection_send_message_with_reply_sync(connection, barrier);
    return reply && xpc_get_type(reply) == XPC_TYPE_DICTIONARY;
}

static void touch(xpc_connection_t connection, uint64_t phase, double x, double y) {
    xpc_object_t point = xpc_dictionary_create_empty();
    xpc_dictionary_set_double(point, "x", x);
    xpc_dictionary_set_double(point, "y", y);
    xpc_object_t payload = xpc_dictionary_create_empty();
    xpc_dictionary_set_value(payload, "pointOne", point);
    xpc_dictionary_set_uint64(payload, "edge", 0);
    xpc_dictionary_set_uint64(payload, "target", 0);
    xpc_dictionary_set_uint64(payload, "eventType", phase);
    xpc_object_t message = xpc_dictionary_create_empty();
    xpc_dictionary_set_string(message, "messageType", "IndigoDigitizerEvent");
    xpc_dictionary_set_string(message, "featureIdentifier", service);
    xpc_dictionary_set_bool(message, "isBarrier", false);
    xpc_dictionary_set_value(message, "payload", payload);
    xpc_connection_send_message(connection, message);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 1;
        xpc_connection_t connection = connectDigitizer(@(argv[1]), @(argv[2]));
        if (!connection || !barrier(connection)) return 2;
        setvbuf(stdout, NULL, _IOLBF, 0);
        puts("ready");
        bool held = false;
        double x = 0, y = 0;
        char line[128];
        struct pollfd input = { STDIN_FILENO, POLLIN, 0 };
        setvbuf(stdin, NULL, _IONBF, 0);
        while (true) {
            int readable = poll(&input, 1, held ? 10000 : -1);
            if (readable == 0) {
                touch(connection, 2, x, y);
                held = false;
                continue;
            }
            if (readable < 0 && errno == EINTR) continue;
            if (readable < 0 || !fgets(line, sizeof(line), stdin)) break;
            @autoreleasepool {
                char phase;
                double nextX, nextY;
                if (sscanf(line, "%c %lf %lf", &phase, &nextX, &nextY) != 3 ||
                    !(nextX >= 0 && nextX <= 1 && nextY >= 0 && nextY <= 1)) break;
                if (phase == 'd' && held) touch(connection, 2, x, y);
                if (phase == 'd' || (held && (phase == 'm' || phase == 'u'))) {
                    x = nextX;
                    y = nextY;
                    touch(connection, phase == 'd' ? 0 : phase == 'm' ? 1 : 2, x, y);
                    held = phase != 'u';
                    if (!barrier(connection)) return 2;
                }
                puts("ok");
            }
        }
        if (held) {
            touch(connection, 2, x, y);
            barrier(connection);
        }
        return 0;
    }
}
