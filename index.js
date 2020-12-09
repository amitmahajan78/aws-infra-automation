"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");

// Allocate a new VPC with a smaller CIDR range:
const vpc = new awsx.ec2.Vpc("custom", {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    subnets: [{ type: "public" }, { type: "private" }],
    numberOfNatGateways: 1,
});

exports.vpcId = vpc.id;
exports.vpcPrivateSubnetIds = vpc.privateSubnetIds;
exports.vpcPublicSubnetIds = vpc.publicSubnetIds;

// Allocate a security group and then a series of rules:
const sg = new awsx.ec2.SecurityGroup("web-access-sg", { vpc });

sg.createIngressRule("https-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.TcpPorts(80),
    description: "allow HTTP access from anywhere",
});

sg.createIngressRule("ssh-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.TcpPorts(22),
    description: "allow SSH access from anywhere",
});

sg.createEgressRule("outbound-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.AllTcpPorts(),
    description: "allow outbound access to anywhere",
});

exports.securityGroup = sg.id;

// Create EC2 instance
const size = "t2.micro";     // t2.micro is available in the AWS free tier
const ami = pulumi.output(aws.getAmi({
    filters: [{
        name: "name",
        values: ["amzn-ami-hvm-*"],
    }],
    owners: ["137112412989"], // This owner ID is Amazon
    mostRecent: true,
}));

const userData1 = // <-- ADD THIS DEFINITION
    `#!/bin/bash
    echo "Hello, from Webserver 1!" > index.html
    nohup python -m SimpleHTTPServer 80 &`;

const userData2 = // <-- ADD THIS DEFINITION
    `#!/bin/bash
    echo "Hello, from Webserver 2!" > index.html
    nohup python -m SimpleHTTPServer 80 &`;

const ec2_1 = new aws.ec2.Instance("webserver-www-1", {
    instanceType: size,
    vpcSecurityGroupIds: [sg.id], // reference the security group resource above
    ami: ami.id,
    subnetId: pulumi.output(vpc.publicSubnetIds)[0],
    userData: userData1,
});

const ec2_2 = new aws.ec2.Instance("webserver-www-2", {
    instanceType: size,
    vpcSecurityGroupIds: [sg.id], // reference the security group resource above
    ami: ami.id,
    subnetId: pulumi.output(vpc.publicSubnetIds)[1],
    userData: userData2,
});


//Load balancer setup

// Create a security group to open ingress to our load balancer on port 80, and egress out of the VPC.
const sgLB = new awsx.ec2.SecurityGroup("web-lb-sg", {
    vpc,
    // 1) Open ingress traffic to your load balancer. Explicitly needed for NLB, but not ALB:
    // ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: [ "0.0.0.0/0" ] }],
    // 2) Open egress traffic from your EC2 instance to your load balancer (for health checks).
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
});


// Creates an ALB associated with the default VPC for this region and listen on port 80.
// 3) Be sure to pass in our explicit SecurityGroup created above so that traffic may flow.
const alb = new awsx.lb.ApplicationLoadBalancer("web-traffic", { vpc: vpc, securityGroups: [sgLB] });
const listener = alb.createListener("web-listener", { port: 80 });

alb.attachTarget("target-1", ec2_1);
alb.attachTarget("target-2", ec2_2);


exports.associatePublicIpAddress = ec2_1.associatePublicIpAddress;
exports.associatePublicIpAddress = ec2_2.associatePublicIpAddress;
exports.endpoint = listener.endpoint.hostname;